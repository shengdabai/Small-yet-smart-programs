<div align="center">

# 🔭 Small Yet Smart Programs

**A daily scout that finds small, profitable, replicable software to build — and is honest enough to tell you when nothing is worth it.**
**每天帮你在全网找到「小而美、能赚钱、抄得动」的软件机会,也敢告诉你「这个对你不值得做」。**

[![Last commit](https://img.shields.io/github/last-commit/shengdabai/Small-yet-smart-programs?style=flat-square)](https://github.com/shengdabai/Small-yet-smart-programs/commits)
[![Stars](https://img.shields.io/github/stars/shengdabai/Small-yet-smart-programs?style=social)](https://github.com/shengdabai/Small-yet-smart-programs/stargazers)
[![Follow @shengdabai](https://img.shields.io/github/followers/shengdabai?style=social)](https://github.com/shengdabai)

[![Daily scan](https://img.shields.io/badge/scan-daily%2012%3A30-brightgreen?style=flat-square)](#-how-it-works)
[![Bilingual](https://img.shields.io/badge/lang-EN%20%2F%20%E4%B8%AD%E6%96%87-blue?style=flat-square)](#-中文)
[![7-dim rubric](https://img.shields.io/badge/rubric-7--dim%20OPC-orange?style=flat-square)](METHODOLOGY.md)
[![Anti-hype](https://img.shields.io/badge/principle-anti--hype-red?style=flat-square)](METHODOLOGY.md)
[![Bun + SQLite](https://img.shields.io/badge/stack-Bun%20%2B%20SQLite-black?style=flat-square)](#-tech-stack)

**English** ｜ **[中文](#-中文)** ｜ **[📊 Methodology](METHODOLOGY.md)** ｜ **[🗂 Daily briefings](daily/)** ｜ **[⚙️ Deploy](docs/AUTOMATION.md)**

</div>

---

<!-- BRIEFINGS:START -->

### 📅 每日简报 · Daily Briefings

- **[2026-06-08](daily/2026-06-08.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token
- **[2026-06-07](daily/2026-06-07.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token
- **[2026-06-06](daily/2026-06-06.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token
- **[2026-06-05](daily/2026-06-05.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token

> 每天中午 12:30 自动更新 · Auto-updated daily at 12:30 · [全部简报 →](daily/)

<!-- BRIEFINGS:END -->

## 🇬🇧 English

> Built in public by **[Tony (Sheng)](https://github.com/shengdabai)** — a Chinese-language teacher with 6,000+ students, building AI tools for teaching and for indie makers.

### Why it exists

Ever felt this?

> You want to build a side project, so you scroll Product Hunt, Hacker News, endless leaderboards…
> The more you scroll, the more anxious you get. Your bookmarks fill with "looks hot" ideas, but you ship none of them.
> You finally pick one — only to find the window already closed, or that it's a giant's game you can't win.

Most "idea finder" tools manufacture FOMO. **Small Yet Smart Programs runs on the opposite principles** — its rarest feature isn't telling you "this is hot," it's daring to say **"this isn't worth it, for *you*."**

- **Honesty over hype** — most months, the right answer is "nothing worth building." It will plainly report `⭐⭐⭐ = 0` instead of inventing excitement.
- **Good *for you* is the only good** — a goldmine for someone else can be a trap for you. One scoring dimension asks: *"of the assets this success depends on, how many do you have?"* None → penalty.
- **Seeing ≠ shipping** — discovery to launch is 8–12 weeks; the window may already be gone. The system forces you to ask "will I still make it?"
- **A tool is a magnifier, not a replacement** — it gathers, filters, and visualizes; **the final call is always yours.** A ⭐⭐⭐ means "worth a personal look," never "go all in now."

### ✨ Features

- **8 public signal sources, zero paid API** — Hacker News, Reddit, Product Hunt, IndieHackers, Toolify, Google Trends, X builders, SimilarWeb.
- **Disciplined 7-dimension scoring** — every survivor scored 1–5 across 7 dimensions (total 7–35), tiered into ⭐⭐⭐ / ⭐⭐ / ✗.
- **Scores *for you*, not in the abstract** — one dimension reads your own asset profile, so the verdict answers "is this worth it *for me*?"
- **5 hard anti-trap rules** — encoded into the prompts to stop spike-blindness, number worship, and chasing windows that already closed.
- **Honest, bilingual daily briefing** — one-line take + score + window judgment + one-click to the source, readable in 5 minutes.
- **Local-first, your data stays yours** — Bun + SQLite, runs on your machine; optional chat push and a static page for distribution.

### 🧱 Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | **Bun** (TypeScript, ESM) |
| Storage | **SQLite** (local, via `bun:sqlite`) |
| Sources | 8 public scrapers + optional enrichment (BuiltWith, Acquire, Microns) |
| Output | Markdown + HTML briefings, optional chat (Feishu) push, static site |
| Automation | `launchd` (macOS) / `systemd` (server) — see [docs/AUTOMATION.md](docs/AUTOMATION.md) |

> No runtime dependencies — the whole pipeline runs on Bun's standard library.

### 🚀 Quick start

```bash
git clone https://github.com/shengdabai/Small-yet-smart-programs.git
cd Small-yet-smart-programs
bun install
cp config/profile.example.json config/profile.local.json   # fill in your own asset profile
bun run init                # initialize the SQLite DB
bun run scan:daily          # scan all sources (~30s)
bun run report:html         # generate the visual briefing
```

Useful scripts:

```bash
bun run scan:hn             # scan a single source (hn / reddit / ph / ih / toolify / trends / sw)
bun run report:weekly       # weekly / monthly digest
bun run stats               # DB stats
bun run notify              # push the briefing to chat
```

Want it fully automated daily + chat push + a live page? See **[docs/AUTOMATION.md](docs/AUTOMATION.md)**.

### 📖 How it works

From web-wide noise to your phone, in 5 steps:

1. **Gather** — pull fresh candidates daily from 8 public sources, no paid API.
2. **Filter** — 4 yes/no questions (clear customer? real pain? someone paying? still under the radar?) drop the obvious no-gos.
3. **Score** — survivors get a **7-dimension score**, judged by AI against *your own* asset profile.
4. **Surface** — a bilingual briefing: one-line take + score + window + one-click to the source project.
5. **Deliver** — the gist + top picks pushed to chat; the full briefing published to a fast, always-on page.

#### The 7 dimensions (1–5 each, total 7–35)

`Market size · Pain intensity · Willingness to pay · Replicability · Window · `**`Asset fit`**` · Moat`

- **≥ 28 → ⭐⭐⭐** (worth your personal review + a pivot memo)
- **22–27 → ⭐⭐** (shortlist, revisit in 3 months)
- **< 22 → ✗** (discard, kept in the DB for trend baselines)

Plus **5 hard anti-trap rules** (spike blindness, number worship, seeing ≠ shipping, why-you-not-them, scanning-as-procrastination). The full logic — the real soul of this project — lives in **[METHODOLOGY.md](METHODOLOGY.md)**.

### 🗺️ Status

Active, runs daily. Personal tool, shared in public — see the [daily briefings](daily/) for live output. Feedback and ideas welcome via [issues](https://github.com/shengdabai/Small-yet-smart-programs/issues).

### 🤝 Connect / About

Built by **Tony (Sheng)** — a Chinese-language teacher (6,000+ students) building AI + Chinese-teaching tools in public.

**If this resonates, [⭐ Star this repo](https://github.com/shengdabai/Small-yet-smart-programs) and [Follow @shengdabai](https://github.com/shengdabai)** to follow the build.

More things I'm building in the open:

- 📝 **[Tony-Articles](https://github.com/shengdabai/Tony-Articles)** — daily bilingual articles, auto-published.
- 🔍 **[gh-audit](https://github.com/shengdabai/gh-audit)** — audit and improve your GitHub repos.
- 🎨 **[content-creator-hub](https://github.com/shengdabai/content-creator-hub)** — tools for content creators.

### 📄 License

Proprietary — all rights reserved. This is a personal project shared for reading and learning; no license to copy, distribute, or reuse is granted. See [LICENSE](LICENSE).

---

## 🇨🇳 中文

> 由 **[Tony(盛)](https://github.com/shengdabai)** 公开构建——一位有 6000+ 学员的中文老师,在公开造 AI 教学工具和独立开发者工具。

### 为什么做这件事

你有没有过这种感觉——

> 想做个副业产品,于是去刷 Product Hunt、Hacker News、各种榜单……
> 越刷越焦虑,收藏夹塞满了「看起来很火」的点子,却没有一个真的动手;
> 好不容易选了一个,做到一半发现窗口早就关了,或者那是巨头的菜、根本轮不到你。

市面上的「选品工具」都在制造 FOMO(怕错过)。**这个项目信奉相反的原则**——它最特别的地方,不是告诉你「这个很火」,而是敢告诉你:**「这个对你不值得做」**。

- **诚实胜过热闹** —— 大多数月份的正确答案是「没有值得做的」。它会坦白地告诉你 `⭐⭐⭐ = 0`,而不是硬凑几个让你兴奋。
- **对你好,才是真的好** —— 一个机会对别人是金矿,对你可能是火坑。评分里有一维专门问:**「成功靠的资产,你有几样?」** 没有就扣分。
- **看到 ≠ 抄到** —— 从发现到上线要 8–12 周,窗口可能早关。系统强制你评估「你做完还来得及吗」。
- **工具是放大镜,不是替身** —— 它只负责收拢、初筛、可视化;**最终判断永远是你的**,⭐⭐⭐ 只是「值得你亲自看一眼」,绝不是「立刻 all in」。

### ✨ 特点

- **8 大公开信号源,零付费 API** —— Hacker News、Reddit、Product Hunt、IndieHackers、Toolify、Google Trends、X、SimilarWeb。
- **克制的 7 维评分** —— 过筛的逐个打 7 个维度(各 1–5 分,总分 7–35),分成 ⭐⭐⭐ / ⭐⭐ / ✗。
- **为「你」打分,而不是泛泛而谈** —— 有一维读你自己的能力画像,答的是「这对**我**值不值得」。
- **5 条反陷阱硬规则** —— 编码进 prompts,防陡增蒙蔽、精确度迷信、追已关窗口。
- **诚实的中英双语简报** —— 一句话点评 + 评分 + 窗口判断 + 一键直达原项目,5 分钟看完。
- **本地优先,数据归你** —— Bun + SQLite,本地运行;可选飞书推送与静态网页用于分发。

### 🧱 技术栈

| 层 | 选择 |
|----|------|
| 运行时 | **Bun**(TypeScript,ESM) |
| 存储 | **SQLite**(本地,`bun:sqlite`) |
| 信号源 | 8 个公开抓取器 + 可选增强(BuiltWith、Acquire、Microns) |
| 产出 | Markdown + HTML 简报,可选飞书推送,静态站 |
| 自动化 | `launchd`(macOS)/ `systemd`(服务器)—— 见 [docs/AUTOMATION.md](docs/AUTOMATION.md) |

> 无运行时依赖——整条流水线跑在 Bun 标准库上。

### 🚀 自己跑起来

```bash
git clone https://github.com/shengdabai/Small-yet-smart-programs.git
cd Small-yet-smart-programs
bun install
cp config/profile.example.json config/profile.local.json   # 填上你自己的能力画像
bun run init                # 初始化 SQLite 数据库
bun run scan:daily          # 扫一遍所有源(约 30 秒)
bun run report:html         # 生成可视化简报
```

常用脚本:

```bash
bun run scan:hn             # 单独扫某个源(hn / reddit / ph / ih / toolify / trends / sw)
bun run report:weekly       # 周报 / 月报
bun run stats               # 数据库统计
bun run notify              # 推送简报到聊天
```

想全自动每天跑 + 飞书推送 + 国内网页?看 **[部署指南 docs/AUTOMATION.md](docs/AUTOMATION.md)**。

### 📖 怎么运作

一份简报,从全网噪音到你手机,经过 5 步:

1. **采集 · Gather** —— 每天自动从 8 大公开信号源拉取候选,零付费 API。
2. **粗筛 · Filter** —— 4 个问题(清晰客户?真实痛点?有人付费?还没火?)淘汰掉一眼就不行的。
3. **评分 · Score** —— 过筛的逐个做 **7 维评分**,由 AI 对照**你自己的能力画像**打分。
4. **呈现 · Surface** —— 生成中英双语简报:一句话点评 + 评分 + 窗口判断 + 一键直达原项目。
5. **推送 · Deliver** —— 核心摘要推到飞书,完整简报发布到一个国内秒开的网页。

#### 7 维评分(各 1–5 分,总分 7–35)

`市场 · 痛点 · 付费意愿 · 可复刻 · 窗口 · `**`资产匹配`**` · 护城河`

- **≥ 28 → ⭐⭐⭐**(值得你人工细看 + 写 pivot 备忘)
- **22–27 → ⭐⭐**(备选,3 个月后回访)
- **< 22 → ✗**(淘汰,但入库做趋势基线)

再叠加 **5 条反陷阱硬规则**(陡增蒙蔽、精确度迷信、看到 ≠ 抄到、为什么是你、把刷榜当逃避)。完整逻辑——这个项目真正的灵魂——见 **[METHODOLOGY.md](METHODOLOGY.md)**。

### 🗺️ 状态

活跃,每天运行。个人工具,公开分享——实时产出见[每日简报](daily/)。欢迎通过 [issues](https://github.com/shengdabai/Small-yet-smart-programs/issues) 提反馈和想法。

### 🤝 关于 / 联系

由 **Tony(盛)** 构建——一位有 6000+ 学员的中文老师,在公开造 AI + 中文教学工具。

**如果这个项目打动了你,[⭐ Star 一下](https://github.com/shengdabai/Small-yet-smart-programs) 并 [关注 @shengdabai](https://github.com/shengdabai)**,跟进后续构建。

我在公开造的其他东西:

- 📝 **[Tony-Articles](https://github.com/shengdabai/Tony-Articles)** —— 每日中英双语文章,自动发布。
- 🔍 **[gh-audit](https://github.com/shengdabai/gh-audit)** —— 审计并优化你的 GitHub 仓库。
- 🎨 **[content-creator-hub](https://github.com/shengdabai/content-creator-hub)** —— 内容创作者工具集。

### 📄 许可

专有 —— 保留所有权利。这是一个公开分享供阅读和学习的个人项目,未授予复制、分发或再利用的许可。见 [LICENSE](LICENSE)。

---

<div align="center">

**📊 [Read the Methodology 读懂方法论](METHODOLOGY.md)** ｜ **🗂 [Browse daily briefings 浏览每日简报](daily/)**

每天扫遍全网,只为告诉你一句诚实的话。
*Scanning the whole web every day — just to tell you one honest thing.*

**[⭐ Star](https://github.com/shengdabai/Small-yet-smart-programs) · [Follow @shengdabai](https://github.com/shengdabai)**

</div>
