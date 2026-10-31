/**
 * Test-only seeder, run as a subprocess so each test file can point
 * SMART_PROGRAMS_DB at its own throwaway database (scripts/db.ts fixes the
 * path on first import, and bun runs every test file in one process).
 *
 * stdin: JSON { candidates: [{ ...CandidateInput, first_seen?, scored? }] }
 *   scored: { total, tier, window_estimate?, summary_zh?, why_them?, replication_difficulty? }
 * stdout: JSON array of inserted candidate ids.
 */
import { db, upsertCandidate, type CandidateInput } from "../../scripts/db.ts";

type Seed = CandidateInput & {
  first_seen?: string;
  scored?: {
    total: number;
    tier: string;
    window_estimate?: string | null;
    summary_zh?: string | null;
    why_them?: string | null;
    replication_difficulty?: string | null;
  };
};

const input = JSON.parse(await Bun.stdin.text()) as { candidates: Seed[] };
const ids: number[] = [];
for (const c of input.candidates) {
  const { id } = upsertCandidate(c);
  if (c.first_seen) db.query("UPDATE candidates SET first_seen = ?, last_seen = ? WHERE id = ?").run(c.first_seen, c.first_seen, id);
  if (c.scored) {
    db.query(
      "INSERT INTO scored (candidate_id, total, tier, window_estimate, summary_zh, why_them, replication_difficulty) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      c.scored.total,
      c.scored.tier,
      c.scored.window_estimate ?? null,
      c.scored.summary_zh ?? null,
      c.scored.why_them ?? null,
      c.scored.replication_difficulty ?? null,
    );
  }
  ids.push(id);
}
process.stdout.write(JSON.stringify(ids));
