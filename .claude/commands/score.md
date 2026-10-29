---
description: 单点研究 - 对给定 URL 跑完整 7 维 OPC 评分(~5 分钟)
argument-hint: <url>
---

# /score <url>

对一个具体产品做完整 v5 §07 评分。用于:
- 运营者 在浏览时看到一个想立刻评估的产品
- 月扫之外的临时调研

## 步骤

### 1. 解析 URL,落库

```bash
cd "${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
URL="${1:-}"

# 空输入处理: 如果 $ARGUMENTS 为空,提示用法并退出
if [ -z "$URL" ]; then
  echo "Usage: /score <url>"
  echo "Example: /score https://example.com"
  exit 1
fi

# URL 合法性校验: 必须 http(s):// 开头
if ! [[ "$URL" =~ ^https?:// ]]; then
  echo "Error: <url> 必须以 http:// 或 https:// 开头,收到: $URL"
  exit 1
fi
bun -e '
import { upsertCandidate } from "./scripts/db.ts";
const url = process.argv[1];
const domain = new URL(url).hostname.replace(/^www\./, "");
const { id, is_new } = upsertCandidate({
  source: "manual/score",
  external_id: url,
  name: domain,
  url,
  description: "(待 fetch)",
  signal_score: 50,
});
console.log(JSON.stringify({ id, is_new }));
' "$URL"
```

### 2. 抓首页 + 定价页(用 Firecrawl MCP)

用 `mcp__firecrawl__firecrawl_scrape`:
- `url: <主页>`, format=markdown, onlyMainContent=true → 得到产品描述
- `url: <主页>/pricing`(如果存在), format=markdown → 得到定价/客户证言

### 3. 抓 SimilarWeb 公开页(可选)

用 `mcp__firecrawl__firecrawl_scrape`:
- `url: https://www.similarweb.com/website/<domain>/`, format=markdown
- 提取月访问量、traffic source、国家分布、6 月趋势(涨/平/降)
- 写入 `traffic_snapshots`

### 4. 跑 BuiltWith 分类

```bash
bun -e '
import { enrichBuiltWith } from "./scripts/enrich/builtwith.ts";
await enrichBuiltWith({ limit: 1 });
'
```
(它会自动找最新无评分的候选,跑分类)

### 5. 7 维评分(Claude 当场出)

读 `prompts/opc-score.md`,带入:
- name / url / description(来自 firecrawl)
- trend_6m / traffic_source(来自 SimilarWeb)
- builtwith_tech / replication_difficulty(来自 step 4)

按 `prompts/coarse-filter.md` 完成四问，并将该候选作为单元素数组写到
`/tmp/smart-programs-scores.json`。字段与 smart-programs Skill 的 Step 4 相同：
`cid`、`passed_a` 至 `passed_d`、`reason_if_dropped`、七个维度、`total`、`tier`、
`why_them`、`window_estimate` 和 `summary`。未过粗筛的候选仍填写保守七维分数，等级为 ✗。

```bash
bun run score:import
```

导入失败则停止，不直接写评分表。已有不同分数或粗筛结果时报告冲突，不覆盖。
该入口仅接收本月首次发现、signal_score ≥ 50 的候选；旧候选需要另行决定复评流程。

### 6. 若 ⭐⭐⭐,生成 pivot 备忘

读 `prompts/pivot-memo.md`,填充字段输出到:
`reports/<date>-<name-slug>-pivot.md`

### 7. 输出给 运营者

```
=== /score <url> 完成 ===
- 7 维: D1=X D2=X D3=X D4=X D5=X D6=X D7=X
- 总分: N/35  Tier: ⭐⭐⭐|⭐⭐|✗
- 复刻难度: Low|Mid|High
- 窗口估算: 6-12月|3-6月|closed
- 建议: <一句>
- pivot 备忘: <path 或 N/A>
```

## Error handling

每步失败的兜底策略,按优先级:

- **URL 不合法 / 为空**: step 1 已拦截退出,不进数据库。
- **`upsertCandidate` 失败 (DB lock / schema 错误)**: 报错 `DB write failed: <err>`,保留错误并检查 `scripts/db.ts`；项目没有 `db:migrate` 命令，不自动重建数据库,本次中止。
- **Firecrawl MCP scrape 失败 / 超时**: 记录 `firecrawl_error=<reason>` 到 candidate.raw_payload,跳过 step 2-3,直接用 URL + domain 进入 step 4 (BuiltWith 仍可独立跑)。
- **SimilarWeb 页面 404 / 抓不到流量**: trend_6m 置 `unknown`,traffic_source 置 `[]`,继续评分但在输出里标注 `traffic data: missing`。
- **`enrichBuiltWith` 失败**: replication_difficulty 置 `unknown`,继续评分,在输出里标注 `tech stack: unknown`。
- **7 维评分 JSON 解析失败**: 报错并打印原始输出供 运营者 复查,不写 scored 表,本次中止 (避免脏数据)。
- **pivot 备忘写文件失败 (磁盘满 / 权限)**: 在输出 step 7 里标注 `pivot memo: write failed, 评分已落库`,不阻断主流程。

整体原则: 数据采集失败 → 降级 + 标注;评分写入失败 → 中止 + 报错。
