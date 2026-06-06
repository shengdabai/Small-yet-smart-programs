<div align="center">

# 🔭 Small Yet Smart Programs

**每天帮你在全网找到「小而美、能赚钱、抄得动」的软件机会**
**A daily scout for small, profitable, replicable software to build**

[![每日更新 / Daily](https://img.shields.io/badge/扫描-每日中午%2012%3A30-brightgreen?style=flat-square)](#-怎么运作)
[![中英双语 / Bilingual](https://img.shields.io/badge/语言-中文%20%2F%20English-blue?style=flat-square)](#-english)
[![7 维评分 / Rubric](https://img.shields.io/badge/评分-7%20维%20OPC-orange?style=flat-square)](METHODOLOGY.md)
[![反炒作 / Anti-hype](https://img.shields.io/badge/原则-反炒作%20·%205%20条反陷阱-red?style=flat-square)](METHODOLOGY.md)
[![Bun + SQLite](https://img.shields.io/badge/stack-Bun%20%2B%20SQLite-black?style=flat-square)](#-自己跑起来)

**[🇨🇳 中文](#-中文)** ｜ **[🇬🇧 English](#-english)** ｜ **[📊 方法论 Methodology](METHODOLOGY.md)** ｜ **[🗂 每日简报 Briefings](daily/)** ｜ **[⚙️ 部署 Deploy](docs/AUTOMATION.md)**

</div>

---

<!-- BRIEFINGS:START -->

### 📅 每日简报 · Daily Briefings

- **[2026-06-06](daily/2026-06-06.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token
- **[2026-06-05](daily/2026-06-05.md)** · ⭐⭐⭐ 0 · ⭐⭐ 1 — Semble:给 AI agent 的代码搜索,省 98% token

> 每天中午 12:30 自动更新 · Auto-updated daily at 12:30 · [全部简报 →](daily/)

<!-- BRIEFINGS:END -->

## 🇨🇳 中文

### 这是什么

你有没有过这种感觉——

> 想做个副业产品,于是去刷 Product Hunt、Hacker News、各种榜单……
> 越刷越焦虑,收藏夹塞满了「看起来很火」的点子,却没有一个真的动手;
> 好不容易选了一个,做到一半发现窗口早就关了,或者那是巨头的菜、根本轮不到你。

**这个项目就是来终结这种焦虑的。**

它每天自动扫遍 8 大公开信号源(Hacker News、Reddit、Product Hunt、IndieHackers、Toolify、Google Trends、X、SimilarWeb),
把成百上千条噪音,用一套**克制、反炒作的 7 维评分法**筛成一份**诚实的机会简报**——
中英双语,每天中午推到你手机,5 分钟看完。

它最特别的地方,不是告诉你「这个很火」,而是敢告诉你:**「这个对你不值得做」**。

### 为什么做这件事

市面上的「选品工具」都在制造 FOMO(怕错过)。这个不一样,它信奉几条相反的原则:

- **诚实胜过热闹** —— 大多数月份的正确答案是「没有值得做的」。这个系统会坦白地告诉你 `⭐⭐⭐ = 0`,而不是硬凑几个让你兴奋。
- **对你好,才是真的好** —— 一个机会对别人是金矿,对你可能是火坑。评分里有一维专门问:**「成功靠的资产,你有几样?」** 没有就扣分。
- **看到 ≠ 抄到** —— 从发现到上线要 8–12 周,窗口可能早关。系统强制评估「你做完还来得及吗」。
- **工具是放大镜,不是替身** —— 它只负责把信号收拢、初筛、可视化;**最终判断永远是你的**,⭐⭐⭐ 也只是「值得你亲自看一眼」,绝不是「立刻 all in」。

如果你也厌倦了被榜单牵着走,想用一套纪律化的方法安静地找项目,这个仓库是为你准备的。

### 怎么运作

一份简报,从全网噪音到你手机,经过 5 步:

**① 采集 · Gather** —— 每天自动从 8 大公开信号源拉取最新候选,零付费 API。

**② 粗筛 · Filter** —— 用 4 个问题(清晰客户?真实痛点?有人付费?还没火?)淘汰掉一眼就不行的。

**③ 评分 · Score** —— 过筛的逐个做 **7 维评分**,由 AI 对照**你自己的能力画像**打分,答的是「这对**我**值不值得」。

**④ 呈现 · Surface** —— 生成中英双语简报:每个项目一句话点评 + 评分 + 窗口判断 + 一键直达原项目。

**⑤ 推送 · Deliver** —— 核心摘要 + 重点项目推到飞书,完整简报发布到一个国内秒开的网页,点开即看。

> 全程基于 Bun + SQLite,本地运行,数据归你自己。

### 🎯 7 维评分 + 5 条反陷阱

评分不是拍脑袋。每个候选打 7 个维度(各 1–5 分,总分 7–35):

| 市场 | 痛点 | 付费 | 可复刻 | 窗口 | **资产匹配** | 护城河 |
|------|------|------|--------|------|------------|--------|

- **≥ 28 分 → ⭐⭐⭐**(值得你人工细看)
- **22–27 → ⭐⭐**(备选,3 个月后回访)
- **< 22 → ✗**(淘汰,但留档做趋势基线)

再叠加 5 条**反陷阱硬规则**(陡增蒙蔽、精确度迷信、看到≠抄到、为什么是你、把刷榜当逃避)——
完整逻辑见 **[METHODOLOGY.md](METHODOLOGY.md)**,这才是这个项目真正的灵魂。

### ⚡ 自己跑起来

```bash
git clone https://github.com/shengdabai/Small-yet-smart-programs.git
cd Small-yet-smart-programs
bun install
cp config/profile.example.json config/profile.local.json   # 填上你自己的能力画像
bun run init
bun run scan:daily        # 30 秒扫一遍
bun run report:html       # 生成可视化报告
```

想全自动每天跑 + 飞书推送 + 国内网页?看 **[部署指南 docs/AUTOMATION.md](docs/AUTOMATION.md)**。

---

## 🇬🇧 English

### What is this

Ever felt this?

> You want to build a side project, so you scroll Product Hunt, Hacker News, endless leaderboards…
> The more you scroll, the more anxious you get. Your bookmarks fill with "looks hot" ideas, but you ship none of them.
> You finally pick one — only to find the window already closed, or that it's a giant's game you can't win.

**This project exists to end that anxiety.**

Every day it scans 8 public signal sources (Hacker News, Reddit, Product Hunt, IndieHackers, Toolify, Google Trends, X, SimilarWeb),
runs the hundreds of noisy candidates through a **disciplined, anti-hype 7-dimension rubric**,
and ships you an **honest briefing** — bilingual, on your phone by noon, readable in 5 minutes.

Its rarest feature isn't telling you "this is hot." It's daring to say: **"this isn't worth it — for you."**

### Why it exists

Most "idea finder" tools manufacture FOMO. This one runs on the opposite principles:

- **Honesty over hype** — most months, the right answer is "nothing worth building." It will plainly report `⭐⭐⭐ = 0` instead of inventing excitement.
- **Good *for you* is the only good** — a goldmine for someone else can be a trap for you. One scoring dimension asks: **"of the assets this success depends on, how many do you have?"** None → penalty.
- **Seeing ≠ shipping** — discovery to launch is 8–12 weeks; the window may already be gone. The system forces you to ask "will I still make it?"
- **A tool is a magnifier, not a replacement** — it gathers, filters, and visualizes; **the final call is always yours.** A ⭐⭐⭐ means "worth a personal look," never "go all in now."

If you're tired of being led by leaderboards and want a calm, disciplined way to find what to build, this repo is for you.

### How it works

From web-wide noise to your phone, in 5 steps:

1. **Gather** — pull fresh candidates daily from 8 public sources, no paid API.
2. **Filter** — 4 yes/no questions drop the obvious no-gos.
3. **Score** — survivors get a **7-dimension score**, judged by AI against *your own* asset profile — answering "is this worth it *for me*?"
4. **Surface** — a bilingual briefing: one-line take + score + window + one-click to the source project.
5. **Deliver** — the gist + top picks pushed to chat; the full briefing published to a fast, always-on page.

Built on Bun + SQLite. Runs locally. Your data stays yours.

### 🎯 The rubric + 5 anti-traps

Seven dimensions, 1–5 each (total 7–35): Market · Pain · Willingness-to-pay · Replicability · Window · **Asset-fit** · Moat.

- **≥ 28 → ⭐⭐⭐** (worth your personal review)
- **22–27 → ⭐⭐** (shortlist, revisit in 3 months)
- **< 22 → ✗** (discard, kept for trend baselines)

Plus 5 hard anti-trap rules (spike blindness, number worship, seeing≠shipping, why-you-not-them, scanning-as-procrastination).
The full logic lives in **[METHODOLOGY.md](METHODOLOGY.md)** — the real soul of this project.

### ⚡ Run it yourself

```bash
git clone https://github.com/shengdabai/Small-yet-smart-programs.git
cd Small-yet-smart-programs
bun install
cp config/profile.example.json config/profile.local.json   # fill in your own asset profile
bun run init
bun run scan:daily
bun run report:html
```

Want it fully automated daily + chat push + a live page? See **[docs/AUTOMATION.md](docs/AUTOMATION.md)**.

---

<div align="center">

**📊 [读懂方法论 Read the Methodology](METHODOLOGY.md)** ｜ **🗂 [浏览每日简报 Browse daily briefings](daily/)**

每天扫遍全网,只为告诉你一句诚实的话。
*Scanning the whole web every day — just to tell you one honest thing.*

</div>
