# Pivot 备忘 Prompt

对每个 ⭐⭐⭐ 候选生成"是否值得 pivot"的 1 页备忘。

## 输入

- 候选完整 7 维评分数据(JSON)
- 当前运营者手头项目:见 config/profile.local.json 的 currentProjects(每项含 name / stage / est / fit)

## 输出格式 (Markdown)

```markdown
# Pivot 备忘: {{candidate_name}}

**评分**: {{total}}/35 | **tier**: {{tier}} | **窗口**: {{window_estimate}}
**信号源**: {{source}} | **复刻难度**: {{replication_difficulty}}
**生成时间**: {{date}}

## TL;DR(3 行)

1. {{这是什么 + 为谁}}
2. {{它在哪个赛道 + 为什么现在涨}}
3. {{运营者 该 pivot / 观察 / 跳过 — 一句话结论}}

## 1. 它是什么 + 客户是谁

(2-3 句,引用 candidates.description + 评分里的 why_them.ta_has)

## 2. 为什么它能赢 (ta_has)

- {{资产 1}}
- {{资产 2}}
- ...

## 3. 运营者 能复用什么 (operator_has)

- {{资产 1}}
- ...
- **缺口**: {{why_them.operator_has 为空的部分}}

## 4. 复刻 plan (若 pivot)

- **MVP 范围**: {{2-3 行,基于 replication_difficulty}}
- **预计 8 周 build 后状态**: {{粗估 MRR / 用户数 / 还能不能赶上窗口期}}
- **机会成本**: 放弃手头 {{当前最相关项目}} 的 W{{x}} 推进

## 5. 决策矩阵

| 维度 | 当前手头项目 | 候选 |
|------|------------|------|
| 评分 | (估) | {{total}} |
| 已投入时间 | {{x}} 周 | 0 |
| 离 PMF 距离 | {{近/远}} | {{很远}} |
| 运营者 资产匹配 | {{高/中/低}} | {{D6 评分对应}} |
| 窗口紧迫 | {{宽松/紧}} | {{window_estimate}} |

## 6. 建议

(基于 v5 §10 决策矩阵):
- 候选评分 > 当前 +5 → **严肃考虑 pivot**(写 pivot 实施 plan)
- 候选评分 > 当前 +2 → **继续观察 3 月**(每月 SimilarWeb 抓快照)
- 候选评分 ≤ 当前 → **继续手头**(归档备忘)

**运营者 的下一步**: {{具体到本周可以做的事}}

## 7. 反陷阱自查

- 陷阱 2(陡增蒙蔽): trend_quality = {{real_growth/single_spike/unknown}} → {{是否信号可靠}}
- 陷阱 3(窗口已关): window_estimate = {{x}} → {{8-12 周后还剩多少}}
- 陷阱 4(为什么是 ta): gap_severity = {{high/mid/low}} → {{运营者 能不能补}}
- 陷阱 1(逃避执行): competing_with = {{...}} → {{是不是只是想换个新鲜的项目逃避手头难题}}

---

(自动生成,源于 v5 信息源全景图 SOP)
```

## 规则

- TL;DR 必须 3 行不能 4 行
- 决策段(第 6 节)必须给一个明确动作,不能"再看看"
- 反陷阱自查 4 项每项必须答,不准跳
