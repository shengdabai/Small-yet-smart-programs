import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const outDir = mkdtempSync(join(tmpdir(), "smart-programs-digest-"));
const DATE = "1999-01-01";

function run(script: string, args: string[]) {
  const proc = Bun.spawnSync({ cmd: ["bun", "run", join(ROOT, "scripts", script), ...args], cwd: ROOT, env: process.env });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

beforeAll(async () => {
  // Seed the isolated test DB (tests/setup.ts) with a hostile candidate dated DATE
  // and a scored ⭐⭐⭐ with a non-web URL.
  const { db, upsertCandidate } = await import("../scripts/db.ts");
  const bad = upsertCandidate({
    source: "hackernews",
    external_id: "xss-1",
    name: `<img src=x onerror="alert(1)">`,
    url: "javascript:alert(document.cookie)",
    title: "t",
    description: `"><script>alert(2)</script>`,
    signal_score: 99,
  });
  const good = upsertCandidate({
    source: "reddit/SaaS",
    external_id: "ok-1",
    name: "Plain Tool",
    url: "https://example.com/tool?a=1&b=2",
    title: "t",
    description: "fine",
    signal_score: 10,
  });
  db.query("UPDATE candidates SET first_seen = ? || ' 10:00:00', last_seen = ? || ' 10:00:00' WHERE id IN (?, ?)")
    .run(DATE, DATE, bad.id, good.id);
  db.query(
    `INSERT INTO scored (candidate_id, total, tier, window_estimate, summary_zh)
     VALUES (?, 30, '⭐⭐⭐', '6-12 个月', '中文点评'), (?, 25, '⭐⭐', NULL, NULL)`,
  ).run(bad.id, good.id);
});

afterAll(() => rmSync(outDir, { force: true, recursive: true }));

describe("daily-digest.ts", () => {
  test("rejects a --date that is not a calendar date and writes nothing", () => {
    const r = run("daily-digest.ts", ["--date", "../../pwned", "--out", outDir]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("invalid --date");
    expect(readdirSync(outDir)).toEqual([]);
  });

  test("renders hostile candidate data as inert text and drops non-http links", () => {
    const r = run("daily-digest.ts", ["--date", DATE, "--out", outDir]);
    expect(r.code).toBe(0);
    const htmlPath = join(outDir, `${DATE}.html`);
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(join(outDir, `${DATE}.md`))).toBe(true);
    const html = readFileSync(htmlPath, "utf8");

    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain('href="https://example.com/tool?a=1&amp;b=2"');
    // the fresh-today section found both seeded rows via the bound date parameter
    expect(r.out).toContain("fresh=2");
    expect(r.out).toContain("⭐⭐⭐=1 ⭐⭐=1");
  });
});

describe("notify-feishu.ts (text mode)", () => {
  test("rejects a malformed --date", () => {
    const r = run("notify-feishu.ts", ["--date", "2026-10-31') OR 1=1 --"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("invalid --date");
  });

  test("counts fresh signals for the bound date and never posts anything", () => {
    const r = run("notify-feishu.ts", ["--date", DATE]);
    expect(r.code).toBe(0);
    expect(r.out).toContain(`机会简报 ${DATE}`);
    expect(r.out).toContain("今日新信号 2");
    expect(r.out).toContain("⭐⭐⭐ 1 · ⭐⭐ 1");
  });
});
