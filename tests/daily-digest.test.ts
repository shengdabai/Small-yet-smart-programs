import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript, seed } from "./helpers/run.ts";

const scratch = mkdtempSync(join(tmpdir(), "smart-programs-digest-"));
const DB = join(scratch, "miner.db");
const outDir = join(scratch, "out");
const DATE = "1999-01-01";
const run = (script: string, args: string[]) => runScript(DB, script, args);

beforeAll(() => {
  Bun.spawnSync({ cmd: ["mkdir", "-p", outDir] });
  // A hostile candidate dated DATE with a non-web URL, scored ⭐⭐⭐, plus a benign ⭐⭐.
  seed(DB, [
    {
      source: "hackernews",
      external_id: "xss-1",
      name: `<img src=x onerror="alert(1)">`,
      url: "javascript:alert(document.cookie)",
      title: "t",
      description: `"><script>alert(2)</script>`,
      signal_score: 99,
      first_seen: `${DATE} 10:00:00`,
      scored: { total: 30, tier: "⭐⭐⭐", window_estimate: "6-12 个月", summary_zh: "中文点评" },
    },
    {
      source: "reddit/SaaS",
      external_id: "ok-1",
      name: "Plain Tool",
      url: "https://example.com/tool?a=1&b=2",
      title: "t",
      description: "fine",
      signal_score: 10,
      first_seen: `${DATE} 10:00:00`,
      scored: { total: 25, tier: "⭐⭐" },
    },
  ]);
});

afterAll(() => rmSync(scratch, { force: true, recursive: true }));

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
