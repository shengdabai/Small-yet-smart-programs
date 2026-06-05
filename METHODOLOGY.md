# Methodology — The 7-Dimension Opportunity Rubric (v5 SOP)

> 中文在下方 · English first.
> This is the scoring logic the scanner automates. It is intentionally
> opinionated and anti-hype. Every rule below exists to stop you from
> chasing a number instead of building a business.

## English

### 1. The funnel

```
8 public signal sources  →  coarse 4-question filter  →  7-dimension score  →  tier
   (HN, Reddit, Toolify,        (drop the obvious           (1–5 each,           ⭐⭐⭐ / ⭐⭐ / ✗
    Google Trends, Product       no-go candidates)           total 7–35)
    Hunt, IndieHackers,
    X builders, SimilarWeb)
```

### 2. Coarse filter — 4 yes/no questions

A candidate must pass **all four** to be worth scoring:

1. **Clear customer** — can you name exactly who pays?
2. **Clear pain** — is it a "can't sleep without it" pain, or a nice-to-have?
3. **Reason to pay** — is there evidence of real, recurring payment (MRR, subs)?
4. **Low visibility** — is it still under the radar (not yet hyped by a16z / big players)?

Fail any one → score it `✗` and keep it in the DB as a baseline only.

### 3. The 7 dimensions (1–5 each, total 7–35)

| Dim | Name | 1 point | 5 points |
|-----|------|---------|----------|
| D1 | Market size | tiny niche, <1k potential | large field, >100k potential |
| D2 | Pain intensity | nice-to-have | mission-critical |
| D3 | Willingness to pay | hypothetical demand | proven recurring revenue |
| D4 | Replicability | high difficulty + strong moat | low difficulty, MVP in <4 weeks |
| D5 | Window | already crowded / giants in | still quiet, 6–12 month window |
| D6 | **Asset fit** | none of *your* assets apply | 4+ of your assets apply directly |
| D7 | Moat | zero moat, pure execution | data flywheel / network effect / exclusive supply |

**D6 reads your own profile** from `config/profile.local.json` (`assets`). The
whole point: an opportunity that's great *for someone else* is not great *for you*.

### 4. Tiers

- **≥ 28** → ⭐⭐⭐ — worth a human review + a pivot memo.
- **22–27** → ⭐⭐ — shortlist, revisit in 3 months.
- **< 22** → ✗ — discard, but keep in the DB for trend baselines.

### 5. The 5 anti-traps (hard rules, encoded in the prompts)

1. **Spike blindness** — a one-month surge may be a KOL retweet, not market lift-off. Require ~3 months of sustained growth before D3 ≥ 4.
2. **Number worship** — never cite exact percentages or visit counts in the rationale. Only "up / flat / down".
3. **Seeing ≠ shipping** — discovery to launch is 8–12 weeks. If the window is ≤ 6 months, you're already too late.
4. **Why them, not you** — always output what assets *they* have vs what *you* have. If your column is empty, force D6 ≤ 2.
5. **Scanning as procrastination** — scanning is a tool, not a daily habit. Don't scan more than ~once a month. A ⭐⭐⭐ is *not* an instant pivot signal: only switch if it beats your current project by **+5 points**.

---

## 中文

### 1. 漏斗

```
8 大公开信号源  →  4 问粗筛  →  7 维评分  →  tier
                  (淘汰明显不行的)   (各 1–5 分,    ⭐⭐⭐ / ⭐⭐ / ✗
                                    总分 7–35)
```

### 2. 粗筛 4 问(全过才评分)

1. **清晰客户** — 能否精确说出谁付费?
2. **清晰痛点** — 是"没它睡不着"的刚需,还是 nice-to-have?
3. **付费理由** — 是否有真实且持续付费的证据(MRR / 订阅)?
4. **低曝光** — 是否还在水下(尚未被 a16z / 巨头炒热)?

任一不过 → 评 `✗`,只入库做趋势 baseline。

### 3. 7 维评分(各 1–5 分,总分 7–35)

| 维度 | 名称 | 1 分 | 5 分 |
|------|------|------|------|
| D1 | 市场规模 | 极小众 <1k | 大行业 >100k |
| D2 | 痛点强度 | 可有可无 | 不可或缺 |
| D3 | 付费意愿 | 假设性需求 | 已验证的持续收入 |
| D4 | 可复刻性 | 难度高 + 强护城河 | 难度低,4 周内 MVP |
| D5 | 窗口期 | 已拥挤 / 巨头入场 | 仍安静,6–12 月窗口 |
| D6 | **资产匹配** | 你一项资产都不沾 | 你 4+ 项资产能直接用 |
| D7 | 护城河 | 零护城河,纯拼执行 | 数据飞轮 / 网络效应 / 独家供给 |

**D6 读你自己的画像**(`config/profile.local.json` 的 `assets`)。核心思想:
一个对别人很好的机会,对你不一定好。

### 4. tier 划分

- **≥ 28** → ⭐⭐⭐:值得人工 review + 写 pivot 备忘。
- **22–27** → ⭐⭐:备选,3 个月后回访。
- **< 22** → ✗:淘汰,但入库做趋势 baseline。

### 5. 反陷阱 5 条(硬规则,已编码进 prompts)

1. **陡增蒙蔽** — 单月暴涨可能是 KOL 转发不是市场起飞。要求约 3 个月持续增长才给 D3 ≥ 4。
2. **精确度迷信** — 评分理由里不准引用具体百分比 / 访问量,只说"涨 / 平 / 降"。
3. **看到 ≠ 抄到** — 从发现到上线 8–12 周。窗口 ≤ 6 月,你已经晚了。
4. **为什么是 ta** — 必须列出"ta 有的资产" vs "你有的资产"。你那栏为空 → 强制 D6 ≤ 2。
5. **把扫描当逃避** — 扫描是工具不是日常,别超过约每月一次。⭐⭐⭐ 不是立刻 pivot 的信号:只有比当前手头项目高 **+5 分** 才换。
