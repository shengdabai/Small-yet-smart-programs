# Small Yet Smart Programs

> A self-hosted scanner that finds **small, profitable, replicable software
> opportunities** across the public web, scores them on a 7-dimension rubric,
> and ships a daily bilingual briefing.
>
> 一个自托管的"机会扫描器":每天从全网公开信号源里找出**小而美、能赚钱、可复刻**的
> 软件项目,用 7 维评分法打分,产出中英双语日报。

---

## English

### What it does

Most "find a SaaS idea" advice is noise. This tool encodes a disciplined,
anti-hype **7-dimension scoring rubric** (see [`METHODOLOGY.md`](./METHODOLOGY.md))
and runs it on autopilot:

1. **Collect** — pull fresh candidates from 8 public signal sources:
   Hacker News, Reddit, Product Hunt, IndieHackers, Toolify, Google Trends,
   X builders, SimilarWeb.
2. **Filter** — a 4-question coarse filter drops the obvious no-go ideas.
3. **Score** — each survivor gets a 7-dimension score (1–5 each, total 7–35),
   run by an LLM in-session against *your own* operator profile, so the result
   answers "is this good **for me**?" not just "is this good?".
4. **Surface** — generates a styled HTML report (radar charts, scatter plot,
   a decision matrix vs your current projects) plus a **daily bilingual briefing**.
5. **Deliver** — pushes a summary to Feishu and publishes the briefing to a
   China-reachable URL.

Built on Bun + SQLite. No paid API key needed for the core sources.

### Architecture

```
.claude/
  skills/smart-programs/SKILL.md     one-shot "scan → score → report" skill
  commands/                          /scan-daily /scan /score /report slash commands
scripts/
  pipeline.ts                        orchestrator (daily / monthly modes)
  db.ts                              SQLite schema + helpers (opportunity DB)
  profile.ts                         loads YOUR operator profile (assets, projects)
  sources/                           8 signal-source collectors
  enrich/builtwith.ts                tech-stack enrichment
  report.ts / report-html-v2.ts      Markdown + rich HTML reports
  daily-digest.ts                    bilingual daily briefing (zh/en)
  build-site.ts                      assembles the static site + timeline index
  notify.ts / notify-feishu.ts       macOS + Feishu notifications
prompts/                             coarse-filter / 7-dim score / pivot-memo prompts
config/
  profile.example.json               template (committed)
  profile.local.json                 YOUR real profile (gitignored, never committed)
METHODOLOGY.md                       the 7-dimension rubric, in full
```

### Quick start

```bash
bun install
cp config/profile.example.json config/profile.local.json   # then edit it
bun run init                  # create the SQLite DB
bun run scan:daily            # ~30s incremental scan
bun run report:html           # build the rich HTML report
```

Then, inside Claude Code, just say `/scan-daily` or invoke the `smart-programs`
skill to run the full collect → score → report flow in one shot.

### Daily automation (12:30)

A launchd job runs the scan every day at **12:30**, has the LLM score the new
candidates, builds a bilingual briefing, publishes it, and pings Feishu.
See [`docs/AUTOMATION.md`](./docs/AUTOMATION.md) for the full operational guide.

### Methodology

The scoring is not arbitrary — read [`METHODOLOGY.md`](./METHODOLOGY.md). The
5 anti-traps (spike blindness, number worship, "seeing ≠ shipping", "why them
not you", scanning-as-procrastination) are the whole point.

### Privacy

The D6 "asset fit" dimension and the decision matrix compare candidates against
*your* assets and current projects. That personal profile lives in
`config/profile.local.json`, which is **gitignored and never committed**. The
repo ships only `config/profile.example.json` with placeholders.

### Commands

| Command | What |
|---------|------|
| `bun run scan:daily` | incremental scan (HN + Reddit + Toolify + Trends) |
| `bun run scan:monthly` | full 8-source scan + enrichment |
| `bun run report:html` | rich HTML report (radar + scatter + matrix) |
| `bun run report:weekly` / `report:monthly` | Markdown reports |
| `bun run stats` | DB stats |

---

## 中文

### 它做什么

大多数"教你找 SaaS 点子"的建议都是噪音。本工具把一套克制、反炒作的
**7 维评分法**(见 [`METHODOLOGY.md`](./METHODOLOGY.md))固化下来,并自动运行:

1. **采集** — 从 8 大公开信号源拉最新候选:Hacker News、Reddit、Product Hunt、
   IndieHackers、Toolify、Google Trends、X builders、SimilarWeb。
2. **粗筛** — 4 问粗筛淘汰明显不行的点子。
3. **评分** — 过筛的逐个做 7 维评分(各 1–5 分,总分 7–35),由 LLM 在会话内
   对照**你自己的运营者画像**打分,所以答的是"这对**我**好不好",而不只是"这好不好"。
4. **呈现** — 生成带样式的 HTML 报告(雷达图、散点图、候选 vs 手头项目决策矩阵)
   外加一份**中英双语日报**。
5. **推送** — 把摘要推到飞书,并把日报发布到国内可访问的 URL。

基于 Bun + SQLite,核心信号源零付费 API key。

### 架构

```
.claude/
  skills/smart-programs/SKILL.md     一键"扫描 → 评分 → 报告"技能
  commands/                          /scan-daily /scan /score /report 命令
scripts/
  pipeline.ts                        总入口(daily / monthly 模式)
  db.ts                              SQLite schema + 工具(机会库)
  profile.ts                         加载你的运营者画像(资产、手头项目)
  sources/                           8 个信号源采集器
  enrich/builtwith.ts                技术栈增强
  report.ts / report-html-v2.ts      Markdown + 富 HTML 报告
  daily-digest.ts                    中英双语日报
  build-site.ts                      组装静态站 + 时间线索引
  notify.ts / notify-feishu.ts       macOS + 飞书通知
prompts/                             粗筛 / 7 维评分 / pivot 备忘 prompts
config/
  profile.example.json               模板(入库)
  profile.local.json                 你的真实画像(gitignored,绝不入库)
METHODOLOGY.md                       完整的 7 维评分法
```

### 快速开始

```bash
bun install
cp config/profile.example.json config/profile.local.json   # 然后填你的画像
bun run init                  # 建 SQLite 库
bun run scan:daily            # ~30 秒增量扫描
bun run report:html           # 生成富 HTML 报告
```

然后在 Claude Code 里直接说 `/scan-daily`,或调用 `smart-programs` 技能,
一口气跑完 采集 → 评分 → 报告。

### 每日自动化(12:30)

一个 launchd 任务每天 **12:30** 跑扫描,由 LLM 给新候选评分,生成中英双语日报,
发布到国内可访问的网页,并推送飞书。完整运维见 [`docs/AUTOMATION.md`](./docs/AUTOMATION.md)。

### 方法论

评分不是拍脑袋 —— 请读 [`METHODOLOGY.md`](./METHODOLOGY.md)。那 5 条反陷阱
(陡增蒙蔽、精确度迷信、看到≠抄到、为什么是 ta、把扫描当逃避)才是精髓。

### 隐私

D6"资产匹配"维度和决策矩阵会拿候选和**你的**资产、手头项目比对。这份个人画像
存在 `config/profile.local.json`,**已 gitignore,绝不入库**。仓库只带一份
占位的 `config/profile.example.json`。

### 命令

| 命令 | 作用 |
|------|------|
| `bun run scan:daily` | 增量扫描(HN + Reddit + Toolify + Trends) |
| `bun run scan:monthly` | 全量 8 源扫描 + 增强 |
| `bun run report:html` | 富 HTML 报告(雷达 + 散点 + 矩阵) |
| `bun run report:weekly` / `report:monthly` | Markdown 报告 |
| `bun run stats` | 数据库统计 |

---

## License

Private / personal use. See [`LICENSE`](./LICENSE).
