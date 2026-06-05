---
description: 生成 Markdown 周报或月报(默认 weekly)
argument-hint: "[weekly|monthly]"
---

# /report [weekly|monthly]

从机会库生成 Markdown 报告。

## 步骤

### 1. 切目录 + 解析参数

```bash
cd "${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"

# 空输入处理: $ARGUMENTS 为空时默认 weekly
MODE="${1:-weekly}"
case "$MODE" in
  weekly|monthly)
    echo "Report mode: $MODE"
    ;;
  *)
    echo "Error: 未知模式 '$MODE',只支持 weekly|monthly"
    echo "Usage: /report [weekly|monthly]"
    exit 1
    ;;
esac
```

### 2. 跑报告生成

```bash
# weekly(默认): 最近 7 天
# monthly: 最近 30 天 + 决策矩阵
bun run report:$MODE
```

### 3. 读生成的报告并展示

```bash
ls -t reports/*.md | head -1 | xargs cat
```

### 4. (可选) 推送

如果 运营者 想要飞书推送:
- 用 lark-cli 或 webhook 把报告发到 "扫描周报" 群
- 短摘要(TL;DR 段)发 IM,完整 markdown 链接附后

```bash
# 飞书 webhook 推送示例(需先配 LARK_WEBHOOK)
[ -n "$LARK_WEBHOOK" ] && curl -sX POST "$LARK_WEBHOOK" \
  -H "Content-Type: application/json" \
  -d "{\"msg_type\":\"text\",\"content\":{\"text\":\"$(head -20 reports/$(ls -t reports/ | head -1) | sed 's/\"/\\\"/g' | tr '\n' ' ')\"}}"
```

### 5. 输出给 运营者

显示报告路径 + TL;DR 段 + ⭐⭐⭐ 数量。

## Error handling

- **`reports/` 目录为空 / `bun run report:*` 失败**: 报错 `Report generation failed: <err>`,提示用户先跑 `/scan-daily` 或 `/scan` 累积数据,本次中止。
- **生成的 markdown 文件为 0 字节**: 视为生成失败,删除空文件并报错,提示用户检查 `scripts/report.ts` 日志。
- **`ls -t reports/*.md` 找不到任何文件**: 报错 `No reports found after generation,检查 reports/ 写入权限`,中止 step 3。
- **`LARK_WEBHOOK` 未设置**: step 4 直接跳过推送 (`[ -n "$LARK_WEBHOOK" ]` 已隐式处理),在 step 5 输出里标注 `lark push: skipped (no webhook)`,不报错。
- **`curl` 推送返回非 2xx**: 打印 webhook 响应体,继续完成 step 5,不阻断 (报告已生成成功,推送是 bonus)。

整体原则: 报告生成失败 → 中止;推送失败 → 降级 + 标注。
