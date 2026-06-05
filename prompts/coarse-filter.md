# 粗筛 Prompt (v5 §07-2 的 4 问)

对每个候选项,严格按 4 问 yes/no 判断,不准答"可能/或许"。

## 输入

候选:
- 名称: {{name}}
- URL: {{url}}
- 来源描述: {{description}}
- 信号源: {{source}} (signal_score={{signal_score}})

## 4 问(全 yes 才入选)

**A. 清晰客户**: 能不能**一句话**说出"它的客户是谁"?(不能模糊到"所有创业者""做内容的人")
- yes 例子: "巴西用葡语做线下课的中小教育主"
- no 例子: "想提升效率的人"

**B. 清晰痛点**: 能不能**一句话**说出"它解决什么具体问题"?
- yes 例子: "把 PDF 教材一键转成可在 WhatsApp 分发的图文卡"
- no 例子: "提升生产力"

**C. 付费理由**: 客户为什么**现在**愿意为它付钱?(不是"理论上可能",是现实推动力)
- yes 例子: "WhatsApp 是巴西第一渠道,但平台不允许长图文,所以需要转格式工具"
- no 例子: "有了它会更好用"

**D. 低曝光**: 没被 TechCrunch / 36 氪 / Substack 头部大号报道
- yes 例子: 搜 google news 找不到中英文媒体报道
- no 例子: a16z portfolio / 出现过 Hacker News 头版头条

## 输出格式

严格 JSON,无解释:
```json
{
  "passed_a": 1 或 0,
  "passed_b": 1 或 0,
  "passed_c": 1 或 0,
  "passed_d": 1 或 0,
  "reason_if_dropped": "短句,如 'B fail: 痛点说不清,只是个 dashboard'",
  "next_check": "若 4 项都过,这里写'enrich + score';否则空"
}
```

## 注意

- **stage 0 阶段**(信号源只给你 title + 短 description),允许保守判断。如果不能确信 B/C,就 0,不强凑。
- **资料不足不是 yes 的理由**。如果 description 里没说客户/痛点,就是 no。
