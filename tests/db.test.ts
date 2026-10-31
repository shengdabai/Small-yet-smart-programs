import { describe, expect, test } from "bun:test";
// tests/setup.ts routes this import to a throwaway database.
import { db, listRecentCandidates, listTopScored, upsertCandidate } from "../scripts/db.ts";

describe("db.ts candidates", () => {
  test("upsert reports is_new only for the first insert, even within the same second", () => {
    const a = upsertCandidate({ source: "hackernews", external_id: "dup", name: "A", signal_score: 1 });
    const b = upsertCandidate({ source: "hackernews", external_id: "dup", name: "A", signal_score: 7 });
    expect(a.is_new).toBe(true);
    expect(b.is_new).toBe(false);
    expect(b.id).toBe(a.id);
    const row = db.query("SELECT signal_score, name FROM candidates WHERE id = ?").get(a.id) as { signal_score: number; name: string };
    expect(row.signal_score).toBe(7); // conflict path refreshed the score
    expect(row.name).toBe("A");       // but kept the original identity fields
  });

  test("same external_id under another source is a distinct candidate", () => {
    const a = upsertCandidate({ source: "reddit/SaaS", external_id: "shared", name: "r" });
    const b = upsertCandidate({ source: "toolify", external_id: "shared", name: "t" });
    expect(a.is_new).toBe(true);
    expect(b.is_new).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  test("listRecentCandidates binds days, source and limit", () => {
    upsertCandidate({ source: "listsrc", external_id: "1", name: "one", signal_score: 5 });
    upsertCandidate({ source: "listsrc", external_id: "2", name: "two", signal_score: 9 });
    upsertCandidate({ source: "listsrc", external_id: "3", name: "three", signal_score: 1 });
    const all = listRecentCandidates({ source: "listsrc", days: 1, limit: 10 }) as Array<{ name: string }>;
    expect(all.map((r) => r.name)).toEqual(["two", "one", "three"]);
    const top = listRecentCandidates({ source: "listsrc", days: 1, limit: 2 }) as Array<{ name: string }>;
    expect(top.map((r) => r.name)).toEqual(["two", "one"]);
    const none = listRecentCandidates({ source: "listsrc'; DROP TABLE candidates; --", days: 1 });
    expect(none).toEqual([]);
    expect((db.query("SELECT COUNT(*) n FROM candidates").get() as { n: number }).n).toBeGreaterThan(0);
  });

  test("listTopScored filters by minimum total", () => {
    const { id } = upsertCandidate({ source: "scoredsrc", external_id: "s1", name: "scored" });
    db.query("INSERT INTO scored (candidate_id, total, tier) VALUES (?, 24, '⭐⭐')").run(id);
    expect((listTopScored({ minTotal: 22 }) as Array<{ id: number }>).some((r) => r.id === id)).toBe(true);
    expect((listTopScored({ minTotal: 28 }) as Array<{ id: number }>).some((r) => r.id === id)).toBe(false);
  });
});
