import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Data-path regression tests for the daily/monthly scan: SQLite upsert/dedupe, LLM score validation and import,
// the score-export hand-off, the HN/Reddit parsers and the daily digest renderer.
//
// db.ts resolves its database relative to its own file (../data/miner.db), so every test works on a private copy of
// scripts/ inside a temp directory: the real data/miner.db, the network, Feishu, Codex and the launchd job are never touched.

const repo = join(import.meta.dir, "..");
const dirs: string[] = [];
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
});

function project() {
  const dir = mkdtempSync(join(tmpdir(), "smart-programs-data-"));
  dirs.push(dir);
  cpSync(join(repo, "scripts"), join(dir, "scripts"), { recursive: true });
  return dir;
}

async function loadDb(dir: string) {
  return (await import(join(dir, "scripts", "db.ts"))) as typeof import("../scripts/db.ts");
}

function run(dir: string, script: string, args: string[] = []) {
  const result = Bun.spawnSync({ cmd: [process.execPath, "run", join(dir, "scripts", script), ...args], cwd: dir, env: { ...process.env, LC_ALL: "C", TZ: "UTC" } });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

type Db = Awaited<ReturnType<typeof loadDb>>["db"];

function seed(db: Db, upsert: Awaited<ReturnType<typeof loadDb>>["upsertCandidate"], name: string, signal: number, extra: Record<string, unknown> = {}) {
  const { id } = upsert({ source: "test", external_id: `${name}-${signal}`, name, url: `https://example.com/${name}`, description: `${name} desc`, signal_score: signal });
  if (extra.first_seen) db.query("UPDATE candidates SET first_seen = ? WHERE id = ?").run(extra.first_seen as string, id);
  return id;
}

const good = (cid: number, over: Record<string, unknown> = {}) => ({
  cid, passed_a: 1, passed_b: 1, passed_c: 1, passed_d: 1,
  d1_market: 4, d2_pain: 4, d3_paying: 4, d4_replicable: 4, d5_window: 4, d6_assets_fit: 4, d7_moat: 4,
  total: 28, tier: "⭐⭐⭐", why_them: { moat: "x" }, window_estimate: "3-6个月", summary: "中文点评", ...over,
});

describe("db.ts upsert / dedupe", () => {
  test("creates the full schema including migrated Chinese columns", async () => {
    const { db } = await loadDb(project());
    const tables = (db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["candidates", "filtered", "traffic_snapshots", "scored", "decisions"]) expect(tables).toContain(t);
    const cols = (name: string) => (db.query(`PRAGMA table_info(${name})`).all() as { name: string }[]).map((r) => r.name);
    expect(cols("candidates")).toEqual(expect.arrayContaining(["name_zh", "description_zh"]));
    expect(cols("scored")).toContain("summary_zh");
  });

  test("same (source, external_id) is one row: first insert is new, a later sighting is not, identity fields are kept", async () => {
    const { db, upsertCandidate } = await loadDb(project());
    const first = upsertCandidate({ source: "hackernews", external_id: "42", name: "Original", url: "https://a", signal_score: 60, raw_payload: { points: 60 } });
    expect(first.is_new).toBe(true);
    db.query("UPDATE candidates SET first_seen = '2020-01-01 00:00:00', last_seen = '2020-01-01 00:00:00' WHERE id = ?").run(first.id);
    const again = upsertCandidate({ source: "hackernews", external_id: "42", name: "Renamed", url: "https://b", signal_score: 99, raw_payload: { points: 99 } });
    expect(again).toEqual({ id: first.id, is_new: false });
    const row = db.query("SELECT * FROM candidates WHERE id = ?").get(first.id) as Record<string, any>;
    expect(row.name).toBe("Original");
    expect(row.url).toBe("https://a");
    expect(row.signal_score).toBe(99);
    expect(JSON.parse(row.raw_payload)).toEqual({ points: 99 });
    expect(row.first_seen).toBe("2020-01-01 00:00:00");
    expect(row.last_seen > row.first_seen).toBe(true);
    expect((db.query("SELECT COUNT(*) AS n FROM candidates").get() as { n: number }).n).toBe(1);
  });

  test("the same external id from another source is a different candidate", async () => {
    const { db, upsertCandidate } = await loadDb(project());
    const a = upsertCandidate({ source: "hackernews", external_id: "7" });
    const b = upsertCandidate({ source: "reddit/SaaS", external_id: "7" });
    expect(a.id).not.toBe(b.id);
    expect(b.is_new).toBe(true);
    expect((db.query("SELECT COUNT(*) AS n FROM candidates").get() as { n: number }).n).toBe(2);
  });

  test("missing optional fields are stored as NULL, payload as JSON", async () => {
    const { db, upsertCandidate } = await loadDb(project());
    const { id } = upsertCandidate({ source: "s", external_id: "1" });
    const row = db.query("SELECT * FROM candidates WHERE id = ?").get(id) as Record<string, any>;
    expect([row.name, row.url, row.title, row.description, row.signal_score, row.raw_payload]).toEqual([null, null, null, null, null, null]);
  });

  test("listRecentCandidates filters by age and source and orders by signal; listTopScored honours the minimum total", async () => {
    const { db, upsertCandidate, listRecentCandidates, listTopScored } = await loadDb(project());
    const low = seed(db, upsertCandidate, "low", 55);
    const high = seed(db, upsertCandidate, "high", 90);
    seed(db, upsertCandidate, "ancient", 99, { first_seen: "2000-01-01 00:00:00" });
    const recent = listRecentCandidates({ days: 7 }) as { name: string }[];
    expect(recent.map((r) => r.name)).toEqual(["high", "low"]);
    expect(listRecentCandidates({ days: 7, source: "nothing" })).toEqual([]);
    db.query("INSERT INTO scored (candidate_id, total, tier) VALUES (?, 30, '⭐⭐⭐'), (?, 20, '✗')").run(high, low);
    expect((listTopScored() as { name: string }[]).map((r) => r.name)).toEqual(["high"]);
    expect(listTopScored({ minTotal: 10 })).toHaveLength(2);
  });
});

describe("import-scores.ts (LLM score validation gate)", () => {
  async function setup(count = 3) {
    const dir = project();
    const mod = await loadDb(dir);
    const ids = Array.from({ length: count }, (_, i) => seed(mod.db, mod.upsertCandidate, `c${i}`, 60 + i));
    const input = join(dir, "scores.json");
    const importer = (payload: unknown) => {
      writeFileSync(input, typeof payload === "string" ? payload : JSON.stringify(payload));
      return run(dir, "import-scores.ts", ["--input", input]);
    };
    const count_ = (table: string) => (mod.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return { dir, ...mod, ids, importer, count_ };
  }

  test("imports valid scores, derives nothing from the payload it was not given, and reports tiers and what is left", async () => {
    const { ids, importer, db } = await setup(4);
    const r = importer([
      good(ids[0]),
      good(ids[1], { d1_market: 3, d2_pain: 3, d3_paying: 3, d4_replicable: 3, d5_window: 3, d6_assets_fit: 3, d7_moat: 4, total: 22, tier: "⭐⭐" }),
      good(ids[2], { passed_b: 0, tier: "✗", reason_if_dropped: "no paying users" }),
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.trim().split("\n").pop()!)).toEqual({ imported: 3, tiers: { "⭐⭐⭐": 1, "⭐⭐": 1, "✗": 1 }, remaining: 1 });
    const scored = db.query("SELECT candidate_id, total, tier, why_them, window_estimate, summary_zh FROM scored ORDER BY candidate_id").all() as Record<string, any>[];
    expect(scored.map((s) => s.tier)).toEqual(["⭐⭐⭐", "⭐⭐", "✗"]);
    expect(JSON.parse(scored[0].why_them)).toEqual({ moat: "x" });
    expect([scored[0].window_estimate, scored[0].summary_zh]).toEqual(["3-6个月", "中文点评"]);
    const filtered = db.query("SELECT passed_b, dropped_reason FROM filtered WHERE candidate_id = ?").get(ids[2]) as Record<string, any>;
    expect(filtered).toEqual({ passed_b: 0, dropped_reason: "no paying users" });
  });

  test("tier thresholds: 28+ is three stars, 22-27 two, below 22 or any failed filter is a cross", async () => {
    const { ids, importer } = await setup(3);
    const dims = (n: number) => {
      const base = Math.floor(n / 7), extra = n % 7;
      const v = Array.from({ length: 7 }, (_, i) => base + (i < extra ? 1 : 0));
      return { d1_market: v[0], d2_pain: v[1], d3_paying: v[2], d4_replicable: v[3], d5_window: v[4], d6_assets_fit: v[5], d7_moat: v[6], total: n };
    };
    expect(importer([good(ids[0], { ...dims(27), tier: "⭐⭐⭐" })]).code).not.toBe(0); // 27 is not enough for three stars
    expect(importer([good(ids[0], { ...dims(28), tier: "⭐⭐" })]).code).not.toBe(0); // 28 must not be downgraded silently
    expect(importer([good(ids[0], { ...dims(21), tier: "⭐⭐" })]).code).not.toBe(0);
    expect(importer([good(ids[0], { ...dims(30), passed_c: 0, tier: "⭐⭐⭐", reason_if_dropped: "x" })]).code).not.toBe(0);
    expect(importer([good(ids[0], { ...dims(21), tier: "✗" })]).code).toBe(0);
    expect(importer([good(ids[1], { ...dims(22), tier: "⭐⭐" })]).code).toBe(0);
  });

  test("a single bad row rejects the whole file and writes nothing", async () => {
    const { ids, importer, count_ } = await setup(3);
    const r = importer([good(ids[0]), good(ids[1], { total: 29 }), good(ids[2])]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("scores[1].total does not equal the seven dimensions");
    expect(count_("scored")).toBe(0);
    expect(count_("filtered")).toBe(0);
  });

  test("malformed rows are rejected with a precise message", async () => {
    const { ids, importer, count_ } = await setup(2);
    const cases: [string, unknown, string][] = [
      ["not an array", { cid: ids[0] }, "score payload must be a JSON array"],
      ["duplicate cid", [good(ids[0]), good(ids[0])], "cid is duplicated"],
      ["dimension out of range", [good(ids[0], { d1_market: 6, total: 30 })], "d1_market must be an integer from 1 to 5"],
      ["fractional dimension", [good(ids[0], { d2_pain: 4.5 })], "d2_pain must be an integer"],
      ["string dimension", [good(ids[0], { d3_paying: "4" })], "d3_paying must be an integer"],
      ["pass flag not 0/1", [good(ids[0], { passed_a: 2 })], "passed_a must be an integer from 0 to 1"],
      ["missing tier", [good(ids[0], { tier: "" })], "tier is required"],
      ["dropped without reason", [good(ids[0], { passed_d: 0, tier: "✗" })], "reason_if_dropped is required"],
      ["why_them is a string", [good(ids[0], { why_them: "text" })], "why_them must be an object or array"],
      ["summary is a number", [good(ids[0], { summary: 5 })], "summary must be a string"],
      ["cid missing", [good(ids[0], { cid: undefined })], "cid must be an integer"],
      ["unknown cid", [good(9999)], "not an eligible current-month candidate"],
    ];
    for (const [name, payload, message] of cases) {
      const r = importer(payload);
      expect({ name, code: r.code === 0 }).toEqual({ name, code: false });
      expect({ name, ok: r.err.includes(message) }).toEqual({ name, ok: true });
    }
    expect(importer("{ not json").code).not.toBe(0);
    expect(count_("scored")).toBe(0);
  });

  test("only current-month candidates with signal >= 50 can be scored", async () => {
    const { db, upsertCandidate, importer } = await setup(0);
    const weak = seed(db, upsertCandidate, "weak", 49);
    const old = seed(db, upsertCandidate, "old", 80, { first_seen: "2000-01-01 00:00:00" });
    const fine = seed(db, upsertCandidate, "fine", 50);
    expect(importer([good(weak)]).err).toContain("not an eligible current-month candidate");
    expect(importer([good(old)]).err).toContain("not an eligible current-month candidate");
    expect(importer([good(fine)]).code).toBe(0);
  });

  test("re-importing the identical score is idempotent, a conflicting score is refused and leaves the old one intact", async () => {
    const { ids, importer, db, count_ } = await setup(1);
    expect(importer([good(ids[0])]).code).toBe(0);
    expect(importer([good(ids[0])]).code).toBe(0);
    expect(count_("scored")).toBe(1);
    const changed = importer([good(ids[0], { d1_market: 5, total: 29, tier: "⭐⭐⭐" })]);
    expect(changed.code).not.toBe(0);
    expect(changed.err).toContain("already has a different score");
    expect((db.query("SELECT total FROM scored").get() as { total: number }).total).toBe(28);
  });
});

describe("import-scores.ts atomic apply", () => {
  test("a database failure half-way through applying leaves no partial import behind", async () => {
    const dir = project();
    const { db, upsertCandidate } = await loadDb(dir);
    const a = seed(db, upsertCandidate, "first", 70);
    const b = seed(db, upsertCandidate, "second", 71);
    db.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON scored WHEN NEW.candidate_id = ${b} BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;`);
    const input = join(dir, "scores.json");
    writeFileSync(input, JSON.stringify([good(a), good(b)]));
    const r = run(dir, "import-scores.ts", ["--input", input]);
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("simulated disk failure");
    expect((db.query("SELECT COUNT(*) AS n FROM scored").get() as { n: number }).n).toBe(0);
    expect((db.query("SELECT COUNT(*) AS n FROM filtered").get() as { n: number }).n).toBe(0);
  });

  test("the conflicting-score guard is what refuses a changed score (identical rows are accepted, changed ones are not)", async () => {
    const dir = project();
    const { db, upsertCandidate } = await loadDb(dir);
    const id = seed(db, upsertCandidate, "one", 70);
    const input = join(dir, "scores.json");
    const importer = (row: unknown) => { writeFileSync(input, JSON.stringify([row])); return run(dir, "import-scores.ts", ["--input", input]); };
    expect(importer(good(id)).code).toBe(0);
    // same total and tier but a different split across the dimensions is still a different score
    const reshuffled = importer(good(id, { d1_market: 5, d2_pain: 3 }));
    expect(reshuffled.code).not.toBe(0);
    expect(reshuffled.err).toContain("already has a different score");
    // an identical score with a re-worded summary is accepted and refreshes the text
    expect(importer(good(id, { summary: "新的点评" })).code).toBe(0);
    expect((db.query("SELECT summary_zh FROM scored").get() as { summary_zh: string }).summary_zh).toBe("新的点评");
  });
});

describe("export-unscored.ts", () => {
  test("exports only current-month, signal>=50, unscored candidates by signal; private file; latest traffic trend attached", async () => {
    const dir = project();
    const { db, upsertCandidate } = await loadDb(dir);
    const top = seed(db, upsertCandidate, "top", 95);
    const mid = seed(db, upsertCandidate, "mid", 70);
    seed(db, upsertCandidate, "weak", 49);
    seed(db, upsertCandidate, "old", 99, { first_seen: "2000-01-01 00:00:00" });
    const done = seed(db, upsertCandidate, "done", 88);
    db.query("INSERT INTO scored (candidate_id, total, tier) VALUES (?, 25, '⭐⭐')").run(done);
    db.query("INSERT INTO traffic_snapshots (candidate_id, snapshot_date, trend_6m) VALUES (?, '2026-01-01', 'old-trend'), (?, '2026-02-01', 'new-trend')").run(top, top);
    const output = join(dir, "to-score.json");
    const r = run(dir, "export-unscored.ts", ["--output", output]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("exported 2 eligible unscored candidates");
    const rows = JSON.parse(readFileSync(output, "utf8"));
    expect(rows.map((x: any) => x.name)).toEqual(["top", "mid"]);
    expect(rows[0].trend_6m).toBe("new-trend");
    expect(rows[1].id).toBe(mid);
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  test("--limit is honoured, capped at 100 and falls back to 30 when invalid", async () => {
    const dir = project();
    const { db, upsertCandidate } = await loadDb(dir);
    db.transaction(() => { for (let i = 0; i < 105; i++) upsertCandidate({ source: "t", external_id: String(i), name: `n${i}`, signal_score: 50 + i }); })();
    const count = (limit: string) => {
      const output = join(dir, `o-${limit}.json`);
      expect(run(dir, "export-unscored.ts", ["--output", output, "--limit", limit]).code).toBe(0);
      return JSON.parse(readFileSync(output, "utf8")).length;
    };
    expect(count("5")).toBe(5);
    expect(count("500")).toBe(100);
    expect(count("abc")).toBe(30);
    expect(count("-3")).toBe(30);
  });
});

describe("source parsers (fetch mocked)", () => {
  function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (input: any, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    }) as typeof fetch;
    return calls;
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  test("hackernews: normalises names, falls back to the item link, queries Show HN >= 50 points, and dedupes on re-run", async () => {
    const dir = project();
    const { db } = await loadDb(dir);
    const { fetchHackerNews } = await import(join(dir, "scripts", "sources", "hackernews.ts"));
    const hits = [
      { objectID: "1", title: "Show HN: Foo — a tool for bars", url: "https://foo.dev", points: 120, num_comments: 3, author: "a", created_at: "2026-10-01", story_text: null },
      { objectID: "2", title: "show hn: Baz - yet another thing", url: null, points: 60, num_comments: 0, author: "b", created_at: "2026-10-02", story_text: "story body" },
    ];
    const calls = mockFetch(() => json({ hits }));
    expect(await fetchHackerNews()).toBe(2);
    const query = new URL(calls[0].url);
    expect(query.hostname).toBe("hn.algolia.com");
    expect(query.searchParams.get("tags")).toBe("show_hn");
    expect(query.searchParams.get("numericFilters")).toMatch(/points>=50/);
    const rows = db.query("SELECT external_id, name, url, description, signal_score FROM candidates ORDER BY external_id").all() as Record<string, any>[];
    expect(rows[0]).toMatchObject({ external_id: "1", name: "Foo", url: "https://foo.dev", signal_score: 120 });
    expect(rows[1]).toMatchObject({ name: "Baz", url: "https://news.ycombinator.com/item?id=2", description: "story body" });

    db.query("UPDATE candidates SET first_seen = '2020-01-01 00:00:00', last_seen = '2020-01-01 00:00:00'").run();
    expect(await fetchHackerNews()).toBe(0);
    expect((db.query("SELECT COUNT(*) AS n FROM candidates").get() as { n: number }).n).toBe(2);
  });

  test("hackernews: an API error is raised (so the pipeline reports the source as failed) and stores nothing", async () => {
    const dir = project();
    const { db } = await loadDb(dir);
    const { fetchHackerNews } = await import(join(dir, "scripts", "sources", "hackernews.ts"));
    mockFetch(() => json({ message: "unavailable" }, 503));
    await expect(fetchHackerNews()).rejects.toThrow("HN API 503");
    expect((db.query("SELECT COUNT(*) AS n FROM candidates").get() as { n: number }).n).toBe(0);
  });

  test("reddit: skips NSFW and low-score posts, prefers the external link, isolates failing subreddits, sends a custom User-Agent", async () => {
    const dir = project();
    const { db } = await loadDb(dir);
    const { fetchReddit } = await import(join(dir, "scripts", "sources", "reddit.ts"));
    const post = (over: Record<string, unknown>) => ({ data: { id: "x", title: "T", selftext: "", url: "", permalink: "/r/SideProject/comments/x/t/", score: 100, num_comments: 1, author: "u", created_utc: 1, subreddit: "SideProject", over_18: false, ...over } });
    const calls = mockFetch((url) => {
      if (url.includes("/r/SideProject/")) {
        return json({ data: { children: [
          post({ id: "a", title: "Cool App: it does things", url: "https://coolapp.io", selftext: "s".repeat(1500) }),
          post({ id: "b", title: "Discussion post", url: "https://www.reddit.com/r/SideProject/comments/b/", permalink: "/r/SideProject/comments/b/d/" }),
          post({ id: "c", over_18: true }),
          post({ id: "d", score: 49 }),
        ] } });
      }
      return json({ error: "forbidden" }, 403);
    });
    expect(await fetchReddit()).toBe(2);
    const rows = db.query("SELECT source, external_id, name, url, length(description) AS len FROM candidates ORDER BY external_id").all() as Record<string, any>[];
    expect(rows.map((r) => r.external_id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ source: "reddit/SideProject", name: "Cool App", url: "https://coolapp.io", len: 1000 });
    expect(rows[1].url).toBe("https://www.reddit.com/r/SideProject/comments/b/d/");
    expect(calls.length).toBeGreaterThanOrEqual(9); // every subreddit was still attempted after the failures
    expect(new Headers(calls[0].init?.headers).get("User-Agent")).toContain("smart-programs-research");
  }, 30_000);
});

describe("daily-digest.ts", () => {
  async function digest(prepare?: (m: Awaited<ReturnType<typeof loadDb>>) => void, args: string[] = []) {
    const dir = project();
    const mod = await loadDb(dir);
    prepare?.(mod);
    const date = "2026-03-15";
    const r = run(dir, "daily-digest.ts", ["--date", date, ...args]);
    const read = (ext: string) => (existsSync(join(dir, "daily", `${date}.${ext}`)) ? readFileSync(join(dir, "daily", `${date}.${ext}`), "utf8") : "");
    return { r, html: read("html"), md: read("md"), dir };
  }

  test("empty database still produces both files with the honest-empty wording", async () => {
    const { r, html, md } = await digest();
    expect(r.code).toBe(0);
    expect(r.out).toContain("⭐⭐⭐=0 ⭐⭐=0 fresh=0");
    expect(html).toContain("本期暂无 ⭐⭐⭐");
    expect(html).toContain("今日无新增候选");
    expect(md).toContain("# 机会简报 — 2026-03-15");
    expect(md).toContain("_无_");
  });

  test("scored candidates and the day's fresh signals appear in both formats; Chinese fields win, English is the fallback", async () => {
    const { r, html, md } = await digest(({ db, upsertCandidate }) => {
      const a = seed(db, upsertCandidate, "AlphaTool", 80);
      const b = seed(db, upsertCandidate, "BetaTool", 70);
      db.query("UPDATE candidates SET name_zh = '阿尔法工具' WHERE id = ?").run(a);
      db.query("INSERT INTO scored (candidate_id, total, tier, summary_zh, window_estimate) VALUES (?, 30, '⭐⭐⭐', '中文点评甲', '6个月'), (?, 23, '⭐⭐', NULL, NULL)").run(a, b);
      const fresh = seed(db, upsertCandidate, "FreshOne", 66);
      db.query("UPDATE candidates SET first_seen = '2026-03-15 08:00:00' WHERE id = ?").run(fresh);
    });
    expect(r.out).toContain("⭐⭐⭐=1 ⭐⭐=1 fresh=1");
    expect(md).toContain("**阿尔法工具** · 30/35 ⭐⭐⭐ · 窗口 6个月");
    expect(md).toContain("**BetaTool** · 23/35 ⭐⭐");
    expect(md).toContain("**FreshOne** · 热度 66");
    expect(html).toContain('<span class="zh">阿尔法工具</span><span class="en">AlphaTool</span>');
    expect(html).toContain("中文点评甲");
    expect(html).toContain('<div class="stat t3"><div class="n">1</div>');
  });

  test("hostile names, descriptions and URLs are HTML-escaped", async () => {
    const { html } = await digest(({ db, upsertCandidate }) => {
      const { id } = upsertCandidate({ source: "x", external_id: "1", name: "<img src=x onerror=alert(1)>", url: 'https://e.com/"onmouseover="alert(2)', description: "<script>alert(3)</script> body", signal_score: 90 });
      db.query("INSERT INTO scored (candidate_id, total, tier) VALUES (?, 30, '⭐⭐⭐')").run(id);
    });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(3)");
    expect(html).not.toContain('href="https://e.com/"onmouseover');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("https://e.com/&quot;onmouseover=&quot;alert(2)");
  });

  test("scores older than the look-back window are left out", async () => {
    const { r } = await digest(({ db, upsertCandidate }) => {
      const id = seed(db, upsertCandidate, "Stale", 90);
      db.query("INSERT INTO scored (candidate_id, total, tier, scored_at) VALUES (?, 30, '⭐⭐⭐', '2000-01-01 00:00:00')").run(id);
    });
    expect(r.out).toContain("⭐⭐⭐=0");
  });
});
