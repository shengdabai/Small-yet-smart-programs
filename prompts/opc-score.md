# 7 维 OPC 评分 Prompt (v5 §07-5)

对单个候选给出 7 维 1-5 分,**强制遵守 v5 §09 反陷阱规则**。

## 输入

- name: {{name}}
- url: {{url}}
- description: {{description}}
- 信号源: {{source}}, signal_score: {{signal_score}}
- 6 月 traffic 趋势: {{trend_6m}} (up/flat/down, 没有则 unknown)
- traffic_source: {{traffic_source}} (direct/search/social, 没有则 unknown)
- 国家分布: {{top_country}}
- builtwith 技术栈: {{builtwith_tech}}
- 复刻难度: {{replication_difficulty}} (Low/Mid/High)

## 7 维评分(每维 1-5)

| 维度 | 1 分 | 5 分 |
|------|------|------|
| **D1 市场规模** | 极小众,潜在客户 <1k | 大行业,潜在客户 >100k |
| **D2 痛点强度** | nice-to-have | "如果没它客户睡不着觉" |
| **D3 付费意愿** | 假设性需求 | 看到有真实付费且持续(MRR/订阅/客户头像) |
| **D4 可复刻性** | High 难度 + 强护城河 | Low 难度 + 4 周内能 MVP |
| **D5 窗口期** | 已经被 a16z 关注 / 巨头 in | 仍 "闷声",6-12 月窗口 |
| **D6 资产匹配** | 运营者一项资产都不沾(语言/生态/客户/技能) | 运营者 4+ 项资产能直接用(见 config/profile.local.json 的 assets) |
| **D7 护城河** | 零护城河,纯执行差 | 数据飞轮/网络效应/独家供给 |

## 反陷阱规则(必须严格遵守)

### 陷阱 2: 单月暴涨蒙蔽
- 如果 trend_6m 是 unknown 或单点暴涨(没有连续 3 月 ≥30%),**D3 上限 = 3**,不准给 4-5
- 只奖励"连续 3 月 ≥30% up"或"signal_score 配合 direct >50%"的产品

### 陷阱 4: 为什么是 ta 不是别人
- 必须输出 `why_them`:列出此产品的成功依赖的资产(语言/本地支付/生态/创始人地缘/客户头像/技能门槛),分两栏:
  - "ta 有的": [...]
  - "运营者 也有的": [...]
- 如果"运营者 也有的"为空 → **D6 强制 ≤ 2**

### 陷阱 5: 精确度迷信
- 不准在评分理由里引用具体百分比/visits 数(如 "1370%" "150k visits")
- 只允许说"涨/平/降"

### 陷阱 1: 逃避执行
- 评分末尾必须给 `competing_with`:与运营者当前手头项目(见 config/profile.local.json 的 currentProjects)比较,
  这个候选若 pivot 过去会"互补/替代/无关"——如果"无关"且评分 <30,直接降级到 ⭐⭐
- 因为切换项目本身有 8-12 周机会成本(陷阱 3)

## tier 划分

- **总分 ≥ 28** → ⭐⭐⭐(本月成果,写 pivot 备忘)
- **22-27** → ⭐⭐(备选,3 月后回访)
- **<22** → ✗(淘汰,但保留入库做趋势 baseline)

## 输出格式

严格 JSON:
```json
{
  "d1_market": 1-5,
  "d2_pain": 1-5,
  "d3_paying": 1-5,
  "d4_replicable": 1-5,
  "d5_window": 1-5,
  "d6_assets_fit": 1-5,
  "d7_moat": 1-5,
  "total": 7-35,
  "tier": "⭐⭐⭐" | "⭐⭐" | "✗",
  "window_estimate": "6-12月" | "3-6月" | "closed",
  "why_them": {
    "ta_has": ["创始人地缘资产", "本地支付生态", "细分社群门槛"],
    "operator_has": ["运营者命中的资产(取自 config/profile.local.json 的 assets)"],
    "gap_severity": "high" | "mid" | "low"
  },
  "competing_with": "互补/替代/无关",
  "trend_quality": "real_growth" | "single_spike" | "unknown",
  "summary": "一句话: 为什么值得做 / 为什么淘汰",
  "next_action": "若 ⭐⭐⭐ → 'write pivot memo'; ⭐⭐ → 'observe 3 months'; ✗ → 'skip'"
}
```
