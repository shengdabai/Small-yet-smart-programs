import { readFileSync } from "node:fs";
import { db, init } from "./db.ts";

type Score = Record<string, unknown> & { cid: number };

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

function text(value: unknown, name: string, required = false): string | null {
  if (value == null || value === "") {
    if (required) throw new Error(`${name} is required`);
    return null;
  }
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function jsonText(value: unknown): string {
  if (value == null) return "{}";
  if (typeof value !== "object") throw new Error("why_them must be an object or array");
  return JSON.stringify(value);
}

if (process.argv.includes("--help")) {
  console.log("Usage: bun run score:import [--input /tmp/smart-programs-scores.json]");
  process.exit(0);
}

const input = argValue("--input", "/tmp/smart-programs-scores.json");
const parsed = JSON.parse(readFileSync(input, "utf8"));
if (!Array.isArray(parsed)) throw new Error("score payload must be a JSON array");

init();
const candidate = db.query(`
  SELECT c.id, c.first_seen, c.signal_score,
         s.d1_market, s.d2_pain, s.d3_paying, s.d4_replicable,
         s.d5_window, s.d6_assets_fit, s.d7_moat, s.total, s.tier
  FROM candidates c
  LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE c.id = $cid
    AND c.first_seen >= datetime('now', 'start of month')
    AND c.signal_score >= 50
`);
const upsertFiltered = db.query(`
  INSERT INTO filtered (
    candidate_id, passed_a, passed_b, passed_c, passed_d, dropped_reason
  ) VALUES ($cid, $a, $b, $c, $d, $reason)
  ON CONFLICT(candidate_id) DO UPDATE SET
    passed_a=excluded.passed_a, passed_b=excluded.passed_b,
    passed_c=excluded.passed_c, passed_d=excluded.passed_d,
    dropped_reason=excluded.dropped_reason, filtered_at=datetime('now')
`);
const upsertScored = db.query(`
  INSERT INTO scored (
    candidate_id, d1_market, d2_pain, d3_paying, d4_replicable,
    d5_window, d6_assets_fit, d7_moat, total, tier, why_them,
    window_estimate, summary_zh
  ) VALUES (
    $cid, $d1, $d2, $d3, $d4, $d5, $d6, $d7, $total, $tier,
    $why, $window, $summary
  )
  ON CONFLICT(candidate_id) DO UPDATE SET
    d1_market=excluded.d1_market, d2_pain=excluded.d2_pain,
    d3_paying=excluded.d3_paying, d4_replicable=excluded.d4_replicable,
    d5_window=excluded.d5_window, d6_assets_fit=excluded.d6_assets_fit,
    d7_moat=excluded.d7_moat, total=excluded.total, tier=excluded.tier,
    why_them=excluded.why_them, window_estimate=excluded.window_estimate,
    summary_zh=excluded.summary_zh, scored_at=datetime('now')
`);

const seen = new Set<number>();
const scores = (parsed as Score[]).map((raw, index) => {
  const prefix = `scores[${index}]`;
  const cid = integer(raw.cid, `${prefix}.cid`, 1, Number.MAX_SAFE_INTEGER);
  if (seen.has(cid)) throw new Error(`${prefix}.cid is duplicated`);
  seen.add(cid);

  const passes = ["passed_a", "passed_b", "passed_c", "passed_d"].map((key) =>
    integer(raw[key], `${prefix}.${key}`, 0, 1));
  const dimensions = [
    "d1_market", "d2_pain", "d3_paying", "d4_replicable",
    "d5_window", "d6_assets_fit", "d7_moat",
  ].map((key) => integer(raw[key], `${prefix}.${key}`, 1, 5));
  const total = integer(raw.total, `${prefix}.total`, 7, 35);
  if (total !== dimensions.reduce((sum, value) => sum + value, 0)) {
    throw new Error(`${prefix}.total does not equal the seven dimensions`);
  }
  const allPassed = passes.every((value) => value === 1);
  const expectedTier = allPassed ? (total >= 28 ? "⭐⭐⭐" : total >= 22 ? "⭐⭐" : "✗") : "✗";
  const tier = text(raw.tier, `${prefix}.tier`, true);
  if (tier !== expectedTier) throw new Error(`${prefix}.tier must be ${expectedTier}`);
  const reason = text(raw.reason_if_dropped, `${prefix}.reason_if_dropped`, !allPassed);

  const existing = candidate.get({ $cid: cid }) as Record<string, unknown> | null;
  if (!existing) throw new Error(`${prefix}.cid is not an eligible current-month candidate`);
  if (existing.total != null) {
    const current = [
      existing.d1_market, existing.d2_pain, existing.d3_paying, existing.d4_replicable,
      existing.d5_window, existing.d6_assets_fit, existing.d7_moat,
    ].map(Number);
    if (Number(existing.total) !== total || existing.tier !== tier ||
        current.some((value, dimension) => value !== dimensions[dimension])) {
      throw new Error(`${prefix}.cid already has a different score`);
    }
  }

  return {
    cid, passes, dimensions, total, tier,
    reason,
    why: jsonText(raw.why_them),
    window: text(raw.window_estimate, `${prefix}.window_estimate`),
    summary: text(raw.summary, `${prefix}.summary`),
  };
});

const apply = db.transaction(() => {
  for (const score of scores) {
    upsertFiltered.run({
      $cid: score.cid, $a: score.passes[0], $b: score.passes[1],
      $c: score.passes[2], $d: score.passes[3], $reason: score.reason,
    });
    upsertScored.run({
      $cid: score.cid,
      $d1: score.dimensions[0], $d2: score.dimensions[1],
      $d3: score.dimensions[2], $d4: score.dimensions[3],
      $d5: score.dimensions[4], $d6: score.dimensions[5],
      $d7: score.dimensions[6], $total: score.total, $tier: score.tier,
      $why: score.why, $window: score.window, $summary: score.summary,
    });
  }
});
apply();

const remaining = db.query(`
  SELECT COUNT(*) AS count
  FROM candidates c
  LEFT JOIN scored s ON s.candidate_id = c.id
  WHERE c.first_seen >= datetime('now', 'start of month')
    AND c.signal_score >= 50
    AND s.total IS NULL
`).get() as { count: number };
const tiers = scores.reduce<Record<string, number>>((counts, score) => {
  counts[score.tier] = (counts[score.tier] ?? 0) + 1;
  return counts;
}, {});
console.log(JSON.stringify({ imported: scores.length, tiers, remaining: remaining.count }));
