---
description: 每日轻量扫描 - HN + Reddit + Toolify + GoogleTrends 增量入库(~30 秒)
---

# /scan-daily

执行v5 §07 SOP 的"大撒网"轻量版,只跑公开 API 高速源。

## 步骤

### 1. 切目录 + 装依赖(首次)

```bash
cd "${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
[ -d node_modules ] || bun install
```

### 2. 跑增量

```bash
bun run scan:daily
```

预期 ~30 秒,输出每个源新增数 + db stats。

### 3. 列出今天新进的候选 top 10

```bash
bun -e '
import { db } from "./scripts/db.ts";
const rows = db.query(`
  SELECT source, name, signal_score, url
  FROM candidates
  WHERE first_seen >= datetime("now", "-1 day")
  ORDER BY signal_score DESC NULLS LAST
  LIMIT 10
`).all();
console.table(rows);
'
```

### 4. 输出格式给 Tony

```
=== /scan-daily 完成 ===
新候选: N(本次)  库总量: M
top 10 by signal:
  1. [hackernews] FooApp     - 187pts  https://...
  2. [reddit/SideProject] Bar - 142pts  https://...
建议: 看到 signal_score ≥ 100 的产品 → 跑 /score <url>
```

## 何时跑

- 想了解最近 24h 公开圈有什么新产品时,2 分钟解决
- **不要**设成 cron 每小时跑——v5 §09 陷阱 1(逃避执行)

## 何时不跑

- 上次跑 <12 小时,数据增量太少
- 你正在 v3/v4 项目冲刺,这周跳过

## Error handling

- **`bun install` 失败 (网络 / lockfile 冲突)**: 报错并提示 `rm -rf node_modules bun.lock && bun install`,本次中止。
- **`bun run scan:daily` 失败 (退出码 ≠ 0)**: 检查 stderr 哪个源挂掉 (HN/Reddit/Toolify/GoogleTrends 任一),失败源记录到 `data/scan-errors-<date>.log`,其余源已成功的增量已落库 (db 写入是 per-source 事务),报告 `partial success: X/4 sources` 后继续 step 3。
- **单源 timeout (>30s)**: scan:daily 内部已有 per-source timeout,挂掉的源跳过,不阻断整体。
- **HN/Reddit API 限流 (429)**: 该源本次返回 0 候选 + warning,下次跑自动恢复 (轻量源天然容错)。
- **DB 锁 (SQLITE_BUSY)**: 重试 3 次,仍失败则报错并提示 `检查是否有其他 bun 进程在跑`,本次中止。
- **step 3 列 top 10 时 0 行**: 视为今日无新增 (Reddit/HN 凌晨可能 0 新),输出 `新候选: 0` + 库总量,不报错。

整体原则: 单源失败 → 隔离 + 继续;DB 写入失败 → 中止;0 新增 → 正常输出。
