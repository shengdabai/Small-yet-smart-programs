---
name: smart-programs
description: 7 维机会评分法(v5 SOP)半自动扫描器。用户提到 "smart-programs"、"本方法论"、"扫描"、"选项目"、"小而美"、"找小项目"、"产品研究"、"扫信号源"、"看最近有什么 SaaS" 等任意一个触发词时,从 8 大公开信号源(HN/Reddit/Toolify/GoogleTrends/ProductHunt/IndieHackers/X/SimilarWeb)抓取最新候选 → 粗筛 → Claude 当前会话内联做 7 维 OPC 评分 → 生成带样式的 HTML 可视化报告。前置依赖:本地项目目录 + bun + 网络;ProductHunt/IndieHackers 反爬源走可选的 Firecrawl MCP(已全局配置);SimilarWeb/X 部分接入受公开端点限制,降级处理。不要 undertrigger,只要话题沾边产品发现/小 SaaS 调研都触发。
---

# smart-programs Skill

把 v5 信息源全景图 SOP(方法论详见仓库根的 `METHODOLOGY.md`)
端到端自动化:**用户一句话调起 → 自动跑 → HTML 报告输出 → 打开浏览器看**。

## 触发后立即执行的完整流程

不要问用户任何问题,**直接按以下步骤一口气跑完**。如果中途某步失败,记录 warning 继续,
不要因为一个源挂了就停下来。

### Step 0: 切目录(必须)

```bash
cd "${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
[ -d node_modules ] || bun install
```

### Step 1: 抓 8 大信号源(~30s-4min)

```bash
bun run scan:monthly
```

预期输出每个源的 new candidates 数 + similarweb/builtwith enrich 数。

### Step 2: Firecrawl MCP 兜底反爬源(可选,若 data/firecrawl-todo.json 有内容)

```bash
cat data/firecrawl-todo.json 2>/dev/null
```

如果有 `producthunt` 或 `indiehackers` 条目,用 `mcp__firecrawl__firecrawl_scrape`:
- format=markdown, onlyMainContent=true
- 抓 target_urls 列表
- 从结果里提取产品名+slug+URL,用 inline bun script 写进 candidates 表
- 完成后清空对应 key

如果时间紧或网络不好,**跳过 Step 2 不影响主流程**——HN/Reddit/Toolify 已经够 80% 信号。

### Step 3: 拉本月未评分的 top 候选(20-50 个)

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
init();
const rows = db.query(`
  SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score,
         s.replication_difficulty
  FROM candidates c
  LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE s.total IS NULL
    AND c.signal_score >= 50
  ORDER BY c.signal_score DESC NULLS LAST
  LIMIT 30
`).all();
process.stdout.write(JSON.stringify(rows));
' 2>/dev/null > /tmp/smart-programs-to-score.json
```

### Step 4: 粗筛 + 7 维评分(Claude 当前会话直接跑,无需 API key)

读 `prompts/coarse-filter.md` 和 `prompts/opc-score.md` 作为系统指令,
**严格遵守 v5 §09 反陷阱规则**(单月暴涨自动降权 / why_them 强制输出 / 不引用具体百分比)。

对 /tmp/smart-programs-to-score.json 每条候选:

1. **粗筛 4 问**(清晰客户 / 清晰痛点 / 付费理由 / 低曝光),不过 4 问的直接给 ✗ 评分
2. **过粗筛的做 7 维评分**(D1-D7 各 1-5 分,总分 7-35)
3. **tier 划分**:≥28 = ⭐⭐⭐,22-27 = ⭐⭐,<22 = ✗

**运营者资产 baseline(D6 评分用)**:评分前先读 `config/profile.local.json` 的 `assets` 数组,把候选成功所依赖的资产,与运营者已有资产逐项比对(命中越多 D6 越高)。未配置时回退 `config/profile.example.json`。
- macOS + Mac Studio + 2T 外接硬盘

**写入流程(file-based,可执行)**:

1. Claude 把所有评分结果先以 JSON 格式写到 `/tmp/smart-programs-scores.json`,schema:

```json
[
  {
    "cid": 123,
    "d1_market": 4, "d2_pain": 5, "d3_paying": 3, "d4_replicable": 4,
    "d5_window": 4, "d6_assets_fit": 5, "d7_moat": 3,
    "total": 28, "tier": "⭐⭐⭐",
    "why_them": ["他们有 X 资产你没有", "他们已积累 Y 月渠道"],
    "window_estimate": "9-12 months before saturation"
  }
]
```

用 Write 工具直接写入 `/tmp/smart-programs-scores.json`,不要用 heredoc。

2. 然后跑这个**通用入库脚本**(读 JSON 文件,无占位符,真正可执行):

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
import { readFileSync } from "fs";
init();
const scores = JSON.parse(readFileSync("/tmp/smart-programs-scores.json", "utf8"));
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

### Step 5: 生成 HTML 可视化报告 + 自动打开浏览器

```bash
bun run report:html
```

输出 `reports/<YYYY>-<MM>-report.html`,自动在 macOS 用 `open` 打开浏览器。
样式 mirror 用户原文件 `7 维机会评分法_副本.html`:Fraunces/JetBrains Mono/Noto Serif SC + 米黄底 + 深墨 + 金色 highlight + 卡片/金字塔/反陷阱区。

### Step 6: macOS 通知(若有 ⭐⭐⭐)

```bash
bun run notify
```

### Step 7: gbrain 同步(若 gbrain 在 PATH,自动 skip 否则)

```bash
bun run gbrain-sync 2>/dev/null || true
```

### Step 7.5: 后置验证(必跑,失败即停)

跑完整流程后必须验证产物真实存在,而不是声明"已完成":

```bash
bun -e '
import { db, init } from "./scripts/db.ts";
import { existsSync, statSync, readdirSync } from "fs";
init();
const ym = new Date().toISOString().slice(0, 7);

// 1. DB 有评分写入
const cnt = db.query(`SELECT COUNT(*) as n FROM scored WHERE date(scored_at) >= date("now", "start of month")`).get();
const scoredCount = (cnt as any).n;

// 2. HTML 报告存在且 > 10KB
const reports = readdirSync("reports").filter(f => f.startsWith(ym) && f.endsWith(".html"));
const latest = reports.sort().pop();
const reportPath = latest ? `reports/${latest}` : null;
const reportOk = reportPath && existsSync(reportPath) && statSync(reportPath).size > 10000;

// 3. ⭐⭐⭐ 候选数
const tier3 = db.query(`SELECT COUNT(*) as n FROM scored WHERE tier LIKE "%⭐⭐⭐%" AND date(scored_at) >= date("now", "start of month")`).get();

console.log(JSON.stringify({
  scoredThisMonth: scoredCount,
  reportPath,
  reportSizeKB: reportPath && existsSync(reportPath) ? Math.round(statSync(reportPath).size / 1024) : 0,
  reportOk,
  tier3: (tier3 as any).n,
  pass: scoredCount > 0 && reportOk
}, null, 2));
'
```

如果 `pass: false` → 不要声明完成,告诉用户哪一步产物缺失,让运营者决定要不要重跑。

### Step 8: 最终输出

用户应该看到:

```
✅ smart-programs 完成

📊 本次扫描
  - 候选总量: N (本月新增 M)
  - 评分通过: K
  - ⭐⭐⭐: X | ⭐⭐: Y | ✗: Z

📄 HTML 报告已生成并打开:
  reports/2026-MM-report.html

🎯 ⭐⭐⭐ 候选(若有):
  1. <name> <total>/35 · <window> · <一句话>
  2. ...

⚠️ 反陷阱提醒(v5 §09):
  - 这是机器筛 + 我的初评,⭐⭐⭐ 一定要你人工 review
  - 不要因为有 ⭐⭐⭐ 就立刻 pivot,先和手头项目比较 +5 分差才行
```

## 反工具诱惑(必须遵守)

- **不要主动建议"我每天帮你扫一次"**——v5 §09 陷阱 1
- 用户没说"再扫一次"就不要重复跑 Step 1
- 一次完整流程后,**告诉用户"建议本月就此打住,3 周后再跑一次"**

## 与 OPC skills 的协作

发现 ⭐⭐⭐ 候选后,如果用户想深挖:
- 利基定位 → `/opc-niche-positioning`
- 商业模式 → `/opc-business-model-design`
- MVP 设计 → `/opc-mvp-designer`

本 skill 只负责"发现 + 粗筛 + 评分 + 可视化",深度策略交给 OPC 流程。

## 文件位置约束

所有产物必须在 `${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}/` 下,不要往别处写。
