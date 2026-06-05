---
description: 月度全量扫描 - 8 源 + enrich + 评分 + Markdown 月报(~5-10 分钟)
---

# /scan(月度)

执行v5 §07 完整 SOP。**每月最后一个周日跑一次**,不要更频繁(陷阱 1)。

## 步骤(顺序执行,不要并行)

### 1. 切目录

```bash
cd "${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
[ -d node_modules ] || bun install
```

### 2. 跑全量 monthly

```bash
bun run scan:monthly
```

预期输出 8 源新候选数 + similarweb/builtwith enrich 数 + firecrawl-todo 列表。验收标准: stderr 不含 "ERROR" / "timeout" / "401" / "403" / "5xx" 字样,且每源至少返回 0 条 (退出码 0)。

### 3. 若有 firecrawl-todo,用 Firecrawl MCP 兜底

读 `data/firecrawl-todo.json`,对每个 key:
- 用 `mcp__firecrawl__firecrawl_scrape` 抓 `target_urls`,format=markdown,onlyMainContent=true
- 从结果里提取产品链接 + 名称 + 简短描述
- 用 Bash 调 db.ts 写入 candidates(可用 `bun -e` inline)
- 处理完清空对应 key

参考代码片段(Claude 在 commands 里执行时用):
```typescript
import { upsertCandidate } from "./scripts/db.ts";
upsertCandidate({
  source: "producthunt",
  external_id: "<slug>",
  name: "<from firecrawl markdown>",
  url: "https://www.producthunt.com/posts/<slug>",
  description: "<from firecrawl summary>",
  signal_score: 5,
  raw_payload: { from_firecrawl: true }
});
```

### 4. 粗筛 + 评分(Claude 当场跑)

```bash
# 列出本月所有 new + 未评分的候选
bun -e '
import { db } from "./scripts/db.ts";
const rows = db.query(`
  SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score
  FROM candidates c LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE c.first_seen >= datetime("now", "-30 days")
    AND (s.total IS NULL)
  ORDER BY c.signal_score DESC NULLS LAST
  LIMIT 50
`).all();
console.log(JSON.stringify(rows, null, 2));
' > /tmp/to-score.json
```

然后 Claude 读 `/tmp/to-score.json` + 读 `prompts/coarse-filter.md` + `prompts/opc-score.md`,
对每个候选:
1. 粗筛(4 问) — 不过 4 问的写入 `filtered` 表的 dropped_reason,跳过评分
2. 过粗筛的做 7 维评分 — 写入 `scored` 表

写入用 inline bun script:
```bash
bun -e '
import { db } from "./scripts/db.ts";
const scoreData = { /* 你产出的 JSON */ };
db.query(`INSERT INTO scored (candidate_id, d1_market, d2_pain, d3_paying, d4_replicable, d5_window, d6_assets_fit, d7_moat, total, tier, why_them, window_estimate)
VALUES ($cid, $d1, $d2, $d3, $d4, $d5, $d6, $d7, $total, $tier, $why, $win)
ON CONFLICT(candidate_id) DO UPDATE SET ...`).run({...});
'
```

### 5. 生成月报

```bash
bun run report:monthly
```

输出 `reports/YYYY-MM-monthly.md`。

### 6. 为每个 ⭐⭐⭐ 候选生成 pivot 备忘

读 `prompts/pivot-memo.md` 模板,对每个 ⭐⭐⭐ 候选填充字段,写到:
`reports/YYYY-MM-<name-slug>-pivot.md`

### 7. (可选)写进 gbrain

如果安装了 gbrain,把 ⭐⭐⭐ 候选放进本地脑:
```bash
for memo in reports/$(date +%Y-%m)-*-pivot.md; do
  gbrain put --from-file "$memo" --tag "smart-programs-mining" 2>/dev/null || true
done
```

### 8. 最终输出给用户

```
=== /scan MONTHLY DONE ===
- 新候选: N(本月)
- 评分通过粗筛: M
- ⭐⭐⭐: K(已写 pivot 备忘)
- 月报: reports/YYYY-MM-monthly.md
- 建议下一步: <根据 K 决定>
```

## 反工具诱惑

- 跑完关掉,不要"再扫一次看看",月度就是月度
- ⭐⭐⭐ 数 = 0 (零) 是预期结果,大多数月份都是 0

## Error handling

- **`bun install` 失败 (网络 / lockfile 冲突)**: 报错并提示 `rm -rf node_modules bun.lock && bun install`,本次中止。
- **`bun run scan:monthly` 失败**: 检查哪一源挂掉 (stderr 里会有 source 名),失败源记录到 `data/scan-errors-<date>.log`,其余源已成功的数据已落库,继续 step 3。
- **单源 0 候选 (但未报错)**: 视为该源本月无新增,在 step 8 输出里标注 `<source>: 0 new`,不阻断流程。
- **Firecrawl MCP scrape 失败 (step 3)**: 该 todo key 跳过,记录到 `data/firecrawl-errors-<date>.log`,继续下一个 key;全部失败时报警但仍跑 step 4。
- **粗筛 / 评分 JSON 解析失败 (step 4)**: 该候选写入 `filtered` 表,dropped_reason=`json_parse_error`,继续下一个,不阻断整批。
- **`bun run report:monthly` 失败 (step 5)**: 报错并打印 stderr,但 candidates / scored 表已写入,可手动重跑 `/report monthly`。
- **gbrain 未安装 (step 7)**: `2>/dev/null || true` 已隐式吞错,无 gbrain 时静默跳过,符合预期。

整体原则: 单源失败 → 隔离 + 继续;评分失败 → 跳过单条 + 继续;报告失败 → 中止但保留数据。
