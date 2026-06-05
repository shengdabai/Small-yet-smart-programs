---
description: 7 维机会评分法 v5 SOP 一键全套 — 扫 8 源 + 粗筛 + 7 维评分 + HTML 报告 + 自动开浏览器 + 后置验证(~5-30 分钟)
---

# /smart-programs

**一句话调起,做完所有事,出报告。** 这是 smart-programs skill 的统一入口编排器。
用户输入 `/smart-programs` 后,Claude 不再问任何问题,按下列 9 步顺序跑完,最后给出验证过的产物清单。

中途某步失败 → 记录 warning,继续往下;**只有 Step 8.5 验证不通过才声明失败**,其他步骤失败都不阻塞主链。

---

## Step 0: 锁定项目根 + 装依赖

```bash
PROJECT="${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
cd "$PROJECT"
[ -d node_modules ] || bun install
```

如果 `cd` 失败 → 立刻停,告诉用户项目目录不存在,需要确认路径。其他步骤都不会到这一步。

---

## Step 1: 扫 8 大信号源(~30s-4min)

```bash
bun run scan:monthly
```

预期输出每个源的新候选数 + similarweb/builtwith enrich 计数 + 写入 `data/firecrawl-todo.json`(反爬源的兜底队列)。

源失败不停: 8 源里挂 1-2 个属于常态(HN 限流 / Reddit 502 / Toolify 改版),记录 warning 继续。

---

## Step 2: Firecrawl MCP 兜底(可选,有条件跳过)

读 `data/firecrawl-todo.json`。**满足下列任一条件直接跳过**:
- 文件不存在 / 为空 / 无 `producthunt` 或 `indiehackers` key
- 该次跑动累计已 > 4 min(避免单次跑动失控)

如果要跑:
1. 对 `producthunt` 和 `indiehackers` 两个 key 的 target_urls,用 `mcp__firecrawl__firecrawl_scrape`,参数 `formats=["markdown"]`, `onlyMainContent=true`
2. 从 markdown 里抽产品名/slug/URL/简短描述
3. 用 `bun -e` 调 `upsertCandidate()` 入库
4. 完成后**清空** `firecrawl-todo.json` 对应 key

跳过的话 HN/Reddit/Toolify 已覆盖 80% 信号,不影响后续。

---

## Step 3: 拉出本月未评分的 top 候选

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
import { writeFileSync } from "fs";
init();
const rows = db.query(`
  SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score
  FROM candidates c LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE s.total IS NULL AND c.signal_score >= 50
  ORDER BY c.signal_score DESC NULLS LAST
  LIMIT 30
`).all();
writeFileSync("/tmp/smart-programs-to-score.json", JSON.stringify(rows, null, 2));
console.error(`pulled ${rows.length} candidates to score`);
'
```

如果 `rows.length === 0` → 跳到 Step 6 直接生成报告(可能是本月没新信号,也可能上次已经评完)。

---

## Step 4: 粗筛 + 7 维 OPC 评分(Claude 当场推理)

**Tony 资产 baseline**(D6 评分用):
- 中文母语 + 6000+ 学员渠道(教培)
- Claude Code/Skill/MCP 生态深度玩家
- TypeScript + Next.js + Python 全栈
- 教培内容 production pipeline
- 飞书/微信/小红书/B 站发布渠道
- macOS + Mac Studio + 2T 外接硬盘

**v5 §09 反陷阱必须遵守**:
- 单月暴涨自动降权,只信"连续 3 个月 ≥30%"
- 必须输出 `why_them`(他们有 X 资产你没有),空着 = 这条候选自动 ✗
- 不引用具体百分比,只说"涨/平/降"
- D6(资产 fit)给分要保守,严格对照 baseline

读 `/tmp/smart-programs-to-score.json` + `prompts/coarse-filter.md` + `prompts/opc-score.md`,对每条做:

1. **粗筛 4 问**(清晰客户 / 清晰痛点 / 付费理由 / 低曝光)— 不过的写 `filtered.dropped_reason`,跳过评分
2. **过粗筛的做 7 维评分**(D1-D7 各 1-5 分,总分 7-35)
3. **tier**: ≥28 = ⭐⭐⭐,22-27 = ⭐⭐,<22 = ✗

把所有评分结果以下面 schema 写到 `/tmp/smart-programs-scores.json`(**用 Write 工具,不要 heredoc**):

```json
[
  {
    "cid": 123,
    "d1_market": 4, "d2_pain": 5, "d3_paying": 3, "d4_replicable": 4,
    "d5_window": 4, "d6_assets_fit": 5, "d7_moat": 3,
    "total": 28, "tier": "⭐⭐⭐",
    "why_them": ["他们有 X 资产你没有", "已积累 Y 月渠道"],
    "window_estimate": "9-12 months before saturation"
  }
]
```

然后跑通用入库脚本(读 JSON,无占位符,可执行):

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
import { readFileSync, existsSync } from "fs";
init();
const path = "/tmp/smart-programs-scores.json";
if (!existsSync(path)) { console.error("no scores file, skip"); process.exit(0); }
const scores = JSON.parse(readFileSync(path, "utf8"));
const stmt = db.query(`INSERT INTO scored (candidate_id, d1_market, d2_pain, d3_paying, d4_replicable, d5_window, d6_assets_fit, d7_moat, total, tier, why_them, window_estimate)
VALUES ($cid, $d1, $d2, $d3, $d4, $d5, $d6, $d7, $total, $tier, $why, $win)
ON CONFLICT(candidate_id) DO UPDATE SET
  d1_market=excluded.d1_market, d2_pain=excluded.d2_pain, d3_paying=excluded.d3_paying,
  d4_replicable=excluded.d4_replicable, d5_window=excluded.d5_window,
  d6_assets_fit=excluded.d6_assets_fit, d7_moat=excluded.d7_moat,
  total=excluded.total, tier=excluded.tier, why_them=excluded.why_them,
  window_estimate=excluded.window_estimate, scored_at=datetime("now")`);
let ok = 0;
for (const s of scores) {
  if (typeof s.cid !== "number" || typeof s.total !== "number" || !s.tier) {
    console.error("skipped invalid:", JSON.stringify(s).slice(0, 100));
    continue;
  }
  stmt.run({
    $cid: s.cid, $d1: s.d1_market, $d2: s.d2_pain, $d3: s.d3_paying,
    $d4: s.d4_replicable, $d5: s.d5_window, $d6: s.d6_assets_fit, $d7: s.d7_moat,
    $total: s.total, $tier: s.tier,
    $why: JSON.stringify(s.why_them ?? []), $win: s.window_estimate ?? null,
  });
  ok++;
}
console.error(`scored ${ok}/${scores.length} items`);
'
```

---

## Step 5: 为每个 ⭐⭐⭐ 候选生成 pivot 备忘

读 `prompts/pivot-memo.md` 模板,对每个 ⭐⭐⭐ 候选填充字段,用 Write 工具写到:
`reports/YYYY-MM-<name-slug>-pivot.md`

如果本月没有 ⭐⭐⭐ → 跳过,正常,不报错。

---

## Step 6: 生成 HTML 可视化报告 + 自动开浏览器

```bash
bun run report:html
```

输出 `reports/YYYY-MM-report.html`,在 macOS 上自动 `open` 打开浏览器。
样式 mirror 用户原文件:Fraunces / JetBrains Mono / Noto Serif SC + 米黄底 + 深墨 + 金色 highlight。

---

## Step 7: macOS 通知(如果有 ⭐⭐⭐)

```bash
bun run notify
```

通知失败不阻塞(本机没装 terminal-notifier 时降级 console)。

---

## Step 8: gbrain 同步(如果 gbrain 在 PATH)

```bash
bun run gbrain-sync 2>/dev/null || echo "gbrain skipped"
```

---

## Step 8.5: 后置验证 ← **本步失败必须告诉用户,不许声明完成**

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
import { existsSync, statSync, readdirSync } from "fs";
init();
const ym = new Date().toISOString().slice(0, 7);

const cnt = db.query(`SELECT COUNT(*) as n FROM scored WHERE date(scored_at) >= date("now", "start of month")`).get() as any;
const scoredCount = cnt.n;

const reports = readdirSync("reports").filter(f => f.startsWith(ym) && f.endsWith(".html"));
const latest = reports.sort().pop();
const reportPath = latest ? `reports/${latest}` : null;
const reportOk = !!reportPath && existsSync(reportPath) && statSync(reportPath).size > 10000;
const reportSizeKB = reportPath && existsSync(reportPath) ? Math.round(statSync(reportPath).size / 1024) : 0;

const tier3Rows = db.query(`SELECT c.name, s.total, s.window_estimate FROM scored s JOIN candidates c ON c.id = s.candidate_id WHERE s.tier LIKE "%⭐⭐⭐%" AND date(s.scored_at) >= date("now", "start of month") ORDER BY s.total DESC LIMIT 10`).all() as any[];

console.log(JSON.stringify({
  scoredThisMonth: scoredCount,
  reportPath, reportSizeKB, reportOk,
  tier3Count: tier3Rows.length,
  tier3: tier3Rows.map(r => `${r.name} ${r.total}/35 · ${r.window_estimate}`),
  pass: scoredCount > 0 && reportOk
}, null, 2));
'
```

`pass: false` → 报告给用户哪一环空了(没评分 / 没报告 / 报告太小),不要说"完成"。

---

## Step 9: 最终输出

```
✅ /smart-programs 完成

📊 本月扫描
  - 本月已评分: <scoredThisMonth>
  - ⭐⭐⭐ 候选: <tier3Count>

📄 HTML 报告
  reports/<YYYY>-<MM>-report.html (<reportSizeKB> KB,已自动开浏览器)

🎯 ⭐⭐⭐ 清单(如有)
  1. <name> <total>/35 · <window_estimate>
  2. ...

⚠️  v5 §09 反陷阱提醒
  - 这是机器筛 + Claude 初评,⭐⭐⭐ 必须你人工 review 才算数
  - 不要因为有 ⭐⭐⭐ 就立刻 pivot,要和手头项目比较 +5 分差才算"真值得切换"
  - 下次跑动建议:3 周后,不要每天扫(陷阱 1:陡增蒙蔽)
```

---

## 反工具诱惑(硬规则)

- **跑完即收手**。用户没说"再扫一次"绝不重复 Step 1。
- **不要建议"我每天帮你跑"**。这是 v5 §09 陷阱 1。
- 月末扫一次足够,**告诉用户"建议本月就此打住,3 周后再跑一次"**。
- ⭐⭐⭐ 数 = 0 是**预期默认输出**:历史 12 个月里平均有 9-10 个月该字段为 0。如果某月输出 ≥ 2 个 ⭐⭐⭐,先怀疑是不是评分阈值被改松了 (D6 给分超过 baseline),不要直接采信。

## 与其他命令的关系

| 命令 | 适用 |
|------|------|
| `/smart-programs`(本命令) | **一句话全套**,首选 |
| `/scan` | 等价于本命令,老命名 |
| `/scan-daily` | 增量轻量扫,不评分不报告 |
| `/score <url>` | 单个 URL 深度评分 |
| `/report monthly` 或 `/report weekly` | 只重出报告,不重扫 |

发现 ⭐⭐⭐ 候选 + 用户想深挖时,跳到 OPC 系列:
- `/opc-niche-positioning` — 利基定位
- `/opc-business-model-design` — 商业模式
- `/opc-mvp-designer` — MVP 设计
