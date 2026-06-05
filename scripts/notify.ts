/**
 * macOS 通知 + (可选) 飞书推送
 *
 * 在 scan 结束时调用,只在出现 ⭐⭐⭐ 候选时通知,避免噪音。
 *
 * 用法:
 *   bun run scripts/notify.ts                  # 检查最近 24h 是否有新 ⭐⭐⭐
 *   bun run scripts/notify.ts --force "msg"    # 强制通知
 */
import { db, init } from "./db.ts";
import { execSync } from "node:child_process";

init();

function osascriptNotify(title: string, body: string) {
  const safe = (s: string) => s.replace(/"/g, '\\"').replace(/\n/g, " ");
  try {
    execSync(`osascript -e 'display notification "${safe(body)}" with title "${safe(title)}" sound name "Glass"'`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function checkNewTriple() {
  const rows = db
    .query(
      `SELECT c.name, c.url, s.total, s.scored_at
       FROM scored s JOIN candidates c ON c.id = s.candidate_id
       WHERE s.tier = '⭐⭐⭐'
         AND s.scored_at >= datetime('now', '-1 day')
       ORDER BY s.total DESC
       LIMIT 5`,
    )
    .all() as { name: string; url: string; total: number; scored_at: string }[];
  return rows;
}

const args = process.argv.slice(2);
const force = args.indexOf("--force");

if (force >= 0) {
  const msg = args[force + 1] ?? "manual notification";
  osascriptNotify("扫描器", msg);
  console.log("[notify] forced");
} else {
  const triple = checkNewTriple();
  if (triple.length === 0) {
    console.log("[notify] 最近 24h 无新 ⭐⭐⭐,不通知");
  } else {
    const body = triple.map((r) => `${r.name} (${r.total}/35)`).join(" · ");
    osascriptNotify(`扫描器: ${triple.length} 个 ⭐⭐⭐`, body);
    console.log(`[notify] 通知 ${triple.length} 个新 ⭐⭐⭐`);
  }
}
