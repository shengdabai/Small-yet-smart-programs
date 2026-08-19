import { chmodSync, writeFileSync } from "node:fs";
import { db, init } from "./db.ts";

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

if (process.argv.includes("--help")) {
  console.log("Usage: bun run score:export [--limit 30] [--output /tmp/smart-programs-to-score.json]");
  process.exit(0);
}

const output = argValue("--output", "/tmp/smart-programs-to-score.json");
const requestedLimit = Number(argValue("--limit", "30"));
const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
  ? Math.min(requestedLimit, 100)
  : 30;

init();
const rows = db.query(`
  SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score,
         s.replication_difficulty, s.builtwith_tech,
         (
           SELECT ts.trend_6m
           FROM traffic_snapshots ts
           WHERE ts.candidate_id = c.id
           ORDER BY ts.snapshot_date DESC
           LIMIT 1
         ) AS trend_6m
  FROM candidates c
  LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE c.first_seen >= datetime('now', 'start of month')
    AND c.signal_score >= 50
    AND s.total IS NULL
  ORDER BY c.signal_score DESC, c.first_seen DESC
  LIMIT $limit
`).all({ $limit: limit });

writeFileSync(output, JSON.stringify(rows, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
chmodSync(output, 0o600);
console.log(`exported ${rows.length} eligible unscored candidates to ${output}`);
