/**
 * SQLite 机会库 schema + 工具函数
 *
 * 用 Bun 原生 `bun:sqlite`(零依赖,比 better-sqlite3 还快)。
 *
 * tables:
 *   candidates         所有源进来的原始信号
 *   filtered           4 问粗筛通过的
 *   traffic_snapshots  每周 SimilarWeb 抓的 traffic 快照(算连续 3 月 ≥30% 用)
 *   scored             7 维 OPC 评分结果
 *   decisions          ⭐⭐⭐ 候选的人工决策(pivot/观察/淘汰)
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = decodeURIComponent(new URL("../data/miner.db", import.meta.url).pathname);
if (!existsSync(dirname(DB_PATH))) mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  name          TEXT,
  url           TEXT,
  title         TEXT,
  description   TEXT,
  signal_score  REAL,
  raw_payload   TEXT,
  first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates(source);
CREATE INDEX IF NOT EXISTS idx_candidates_first_seen ON candidates(first_seen);

CREATE TABLE IF NOT EXISTS filtered (
  candidate_id  INTEGER PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  passed_a      INTEGER NOT NULL,
  passed_b      INTEGER NOT NULL,
  passed_c      INTEGER NOT NULL,
  passed_d      INTEGER NOT NULL,
  dropped_reason TEXT,
  filtered_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS traffic_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id  INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  snapshot_date TEXT NOT NULL,
  visits        INTEGER,
  direct_pct    REAL,
  top_country   TEXT,
  visit_duration REAL,
  pages_per_visit REAL,
  trend_6m      TEXT,
  raw_payload   TEXT,
  UNIQUE(candidate_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_snap_candidate ON traffic_snapshots(candidate_id);

CREATE TABLE IF NOT EXISTS scored (
  candidate_id  INTEGER PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  d1_market     INTEGER,
  d2_pain       INTEGER,
  d3_paying     INTEGER,
  d4_replicable INTEGER,
  d5_window     INTEGER,
  d6_assets_fit INTEGER,
  d7_moat       INTEGER,
  total         INTEGER,
  tier          TEXT,
  why_them      TEXT,
  window_estimate TEXT,
  builtwith_tech TEXT,
  replication_difficulty TEXT,
  scored_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scored_total ON scored(total DESC);
CREATE INDEX IF NOT EXISTS idx_scored_tier ON scored(tier);

CREATE TABLE IF NOT EXISTS decisions (
  candidate_id  INTEGER PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  decision      TEXT NOT NULL,
  memo_path     TEXT,
  decided_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

let inited = false;
export function init() {
  if (inited) return;
  db.exec(SCHEMA);
  inited = true;
  // 日志走 stderr,不污染脚本 stdout(JSON pipe 友好)
  console.error("[db] schema ready at", DB_PATH);
}

// 确保任何引用 db 的 caller 先 init(防御性,避免 prepare-before-table 错误)
init();

export type CandidateInput = {
  source: string;
  external_id: string;
  name?: string;
  url?: string;
  title?: string;
  description?: string;
  signal_score?: number;
  raw_payload?: unknown;
};

const upsertStmt = db.query(`
  INSERT INTO candidates (source, external_id, name, url, title, description, signal_score, raw_payload)
  VALUES ($source, $external_id, $name, $url, $title, $description, $signal_score, $raw_payload)
  ON CONFLICT(source, external_id) DO UPDATE SET
    last_seen = datetime('now'),
    signal_score = excluded.signal_score,
    raw_payload = excluded.raw_payload
  RETURNING id, (CASE WHEN first_seen = last_seen THEN 1 ELSE 0 END) AS is_new
`);

export function upsertCandidate(c: CandidateInput): { id: number; is_new: boolean } {
  const row = upsertStmt.get({
    $source: c.source,
    $external_id: c.external_id,
    $name: c.name ?? null,
    $url: c.url ?? null,
    $title: c.title ?? null,
    $description: c.description ?? null,
    $signal_score: c.signal_score ?? null,
    $raw_payload: c.raw_payload ? JSON.stringify(c.raw_payload) : null,
  }) as { id: number; is_new: number };
  return { id: row.id, is_new: row.is_new === 1 };
}

export function listRecentCandidates(opts: { days?: number; source?: string; limit?: number } = {}) {
  const days = opts.days ?? 7;
  const limit = opts.limit ?? 100;
  const sql = `
    SELECT c.*, s.total, s.tier
    FROM candidates c
    LEFT JOIN scored s ON s.candidate_id = c.id
    WHERE c.first_seen >= datetime('now', '-${days} days')
    ${opts.source ? "AND c.source = ?" : ""}
    ORDER BY c.signal_score DESC NULLS LAST, c.first_seen DESC
    LIMIT ${limit}
  `;
  return opts.source ? db.query(sql).all(opts.source) : db.query(sql).all();
}

export function listTopScored(opts: { limit?: number; minTotal?: number } = {}) {
  const limit = opts.limit ?? 20;
  const minTotal = opts.minTotal ?? 22;
  return db
    .query(
      `SELECT c.*, s.total, s.tier, s.window_estimate, s.replication_difficulty
       FROM candidates c
       JOIN scored s ON s.candidate_id = c.id
       WHERE s.total >= ?
       ORDER BY s.total DESC, c.first_seen DESC
       LIMIT ?`,
    )
    .all(minTotal, limit);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--init")) {
    init();
  } else if (args.includes("--stats")) {
    init();
    const { count } = db.query("SELECT COUNT(*) AS count FROM candidates").get() as { count: number };
    const { scored } = db.query("SELECT COUNT(*) AS scored FROM scored").get() as { scored: number };
    const { triple } = db.query("SELECT COUNT(*) AS triple FROM scored WHERE tier = '⭐⭐⭐'").get() as { triple: number };
    console.log(`candidates=${count}  scored=${scored}  ⭐⭐⭐=${triple}`);
  } else {
    init();
    console.log("usage: bun run scripts/db.ts --init | --stats");
  }
}
