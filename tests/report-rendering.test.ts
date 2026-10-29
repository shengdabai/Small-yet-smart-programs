import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only synthetic data is rendered, in disposable copies. No private profile,
// existing reports, real database, network, notification or browser is used.
const scratch: string[] = [];
const repo = join(import.meta.dir, "..");
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "smart-programs-report-"));
  scratch.push(dir);
  cpSync(join(repo, "scripts"), join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "config"));
  writeFileSync(join(dir, "config", "profile.example.json"), JSON.stringify({
    owner: "Fixture", assets: [], currentProjects: [],
  }));
  // report-html-v2 normally opens its output; keep that side effect in the fixture.
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "open"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const { db, upsertCandidate } = await import(join(dir, "scripts", "db.ts")) as typeof import("../scripts/db.ts");
  const seed = (url: string, extra: Record<string, unknown> = {}) => {
    const { id } = upsertCandidate({ source: "fixture", external_id: url, name: "Fixture tool", url, signal_score: 80 });
    db.query(`INSERT INTO scored (candidate_id, total, tier, why_them, replication_difficulty)
              VALUES (?, 28, '⭐⭐⭐', ?, ?)`).run(id, JSON.stringify(extra.why_them ?? {}), (extra.difficulty as string) ?? "Low");
    return id;
  };
  const run = (script: string, args: string[] = [], frozenDate?: string) => {
    const preload: string[] = [];
    if (frozenDate) {
      const clock = join(dir, "clock.ts");
      writeFileSync(clock, `const RealDate = Date;
        globalThis.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [${JSON.stringify(frozenDate)}])); }
          static now() { return new RealDate(${JSON.stringify(frozenDate)}).getTime(); }
        };`);
      preload.push("--preload", clock);
    }
    const result = Bun.spawnSync({
      cmd: [process.execPath, "run", ...preload, join(dir, "scripts", script), ...args], cwd: dir,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, TZ: "UTC" },
    });
    return { code: result.exitCode, err: result.stderr.toString() };
  };
  const report = () => {
    const result = run("report-html-v2.ts");
    expect(result).toMatchObject({ code: 0 });
    return readFileSync(join(dir, "reports", `${new Date().toISOString().slice(0, 7)}-report-v2.html`), "utf8");
  };
  const digest = () => {
    const date = new Date().toISOString().slice(0, 10);
    expect(run("daily-digest.ts", ["--date", date]).code).toBe(0);
    return readFileSync(join(dir, "daily", `${date}.html`), "utf8");
  };
  return { dir, db, seed, report, digest, run };
}

const unsafeUrls = [
  "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)",
  "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)",
  "file:///etc/passwd", "//example.invalid/path", "/relative/path", "not a url",
  "", "https://", "https://[invalid", "https:example.invalid", "https:///",
];

describe("report rendering of untrusted candidate data", () => {
  for (const renderer of ["digest", "report"] as const) {
    test(`${renderer}: only absolute HTTP(S) candidate URLs become links`, async () => {
      const f = await fixture();
      writeFileSync(join(f.dir, "config", "profile.example.json"), JSON.stringify({
        owner: "Fixture", assets: [], currentProjects: [{ name: "Fixture project", stage: "test", est: 20, fit: "fixture" }],
      }));
      for (const url of unsafeUrls) f.seed(url);
      const missingUrl = f.seed("https://example.invalid/missing-url");
      f.db.query("UPDATE candidates SET url = NULL WHERE id = ?").run(missingUrl);
      f.seed('https://example.invalid/path?q="quoted"&n=1');
      f.seed("http://example.invalid/plain");
      const html = f[renderer]();
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      const allowed = new Set(["#", 'https://example.invalid/path?q=&quot;quoted&quot;&amp;n=1', "http://example.invalid/plain"]);
      // The depth report also has static font stylesheet/preconnect links.
      const candidateHrefs = hrefs.filter((href) => !href.startsWith("https://fonts."));
      expect(candidateHrefs.length).toBeGreaterThan(0);
      expect(candidateHrefs.filter((href) => !allowed.has(href))).toEqual([]);
      expect(candidateHrefs).toContain('https://example.invalid/path?q=&quot;quoted&quot;&amp;n=1');
      expect(candidateHrefs).toContain("http://example.invalid/plain");
      expect(candidateHrefs).toContain("#");
    }, 60_000);
  }

  test("depth report escapes score metadata in SVG text and class attributes", async () => {
    const f = await fixture();
    f.seed("https://example.invalid/", {
      difficulty: '</title><script>alert("difficulty")</script>',
      why_them: { gap_severity: 'high"><img src=x onerror="alert(1)">' },
    });
    const html = f.report();
    expect(html).not.toContain('</title><script>alert("difficulty")');
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;");
    expect(html).toContain('class="gap-unknown"');
  }, 60_000);

  test("depth report escapes project labels in its comparison table", async () => {
    const f = await fixture();
    f.seed("https://example.invalid/");
    writeFileSync(join(f.dir, "config", "profile.example.json"), JSON.stringify({
      owner: "Fixture", assets: [], currentProjects: [{ name: '<img src=x onerror="alert(1)">', stage: "<script>alert(2)</script>", est: "<script>alert(3)</script>", fit: "fixture" }],
    }));
    const html = f.report();
    expect(html).not.toContain('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).not.toContain("<script>alert(3)</script>");
    expect(html).toContain("&lt;img src=x");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
  }, 60_000);

  test("depth report tolerates valid JSON payloads that are not objects", async () => {
    const f = await fixture();
    for (const [i, payload] of ["null", "42", '"text"', "[]", "{ broken json"].entries()) {
      const id = f.seed(`https://example.invalid/${i}`);
      f.db.query("UPDATE candidates SET raw_payload = ? WHERE id = ?").run(payload, id);
    }
    expect(f.report()).toContain("Fixture tool");
  }, 60_000);
});

test("weekly report uses the ISO week-year at both calendar-year boundaries", async () => {
  const f = await fixture();
  for (const [date, week] of [
    ["2021-01-01T12:00:00Z", "2020-W53"],
    ["2018-12-31T12:00:00Z", "2019-W01"],
    ["2021-01-04T12:00:00Z", "2021-W01"],
    ["2026-10-29T12:00:00Z", "2026-W44"],
  ]) {
    expect(f.run("report.ts", ["--mode", "weekly"], date).code).toBe(0);
    expect(readFileSync(join(f.dir, "reports", `${week}-weekly.md`), "utf8")).toContain(`# 扫描周报 ${week}`);
  }
}, 60_000);

test("static build preserves the rendered digest and links its archive entry", async () => {
  const f = await fixture();
  f.seed("https://example.invalid/tool");
  const digest = f.digest();
  expect(f.run("build-site.ts").code).toBe(0);
  const date = new Date().toISOString().slice(0, 10);
  expect(readFileSync(join(f.dir, "site", "latest.html"), "utf8")).toBe(digest);
  expect(readFileSync(join(f.dir, "site", `${date}.html`), "utf8")).toBe(digest);
  const index = readFileSync(join(f.dir, "site", "index.html"), "utf8");
  expect(index).toContain(`href="${date}.html"`);
  expect(index).toContain('href="latest.html"');
}, 60_000);
