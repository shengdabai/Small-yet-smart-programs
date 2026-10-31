import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript, seed } from "./helpers/run.ts";

const scratch = mkdtempSync(join(tmpdir(), "smart-programs-report-"));
const DB = join(scratch, "miner.db");
const outDir = join(scratch, "reports");
const binDir = join(scratch, "bin");

beforeAll(() => {
  // A ⭐⭐⭐ candidate with no name at all (sources may store NULL) and one whose
  // name is shell syntax: both used to crash or be shell-interpreted downstream.
  seed(DB, [
    { source: "toolify", external_id: "noname", url: "https://example.com/x", signal_score: 3, scored: { total: 29, tier: "⭐⭐⭐" } },
    {
      source: "hackernews",
      external_id: "hostile",
      name: `Evil"; touch ${join(scratch, "owned")}; echo "`,
      url: "https://example.com/evil",
      signal_score: 50,
      scored: { total: 31, tier: "⭐⭐⭐" },
    },
  ]);

  // Fake `gbrain` that records its argv and drains stdin instead of doing anything.
  Bun.spawnSync({ cmd: ["mkdir", "-p", binDir, outDir] });
  const fake = join(binDir, "gbrain");
  writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${join(scratch, "argv")}"\ncat > /dev/null\n`);
  chmodSync(fake, 0o755);
});

afterAll(() => rmSync(scratch, { force: true, recursive: true }));

describe("report.ts", () => {
  test("monthly report survives a ⭐⭐⭐ candidate whose name is NULL", () => {
    const r = runScript(DB, "report.ts", ["--mode", "monthly", "--out", outDir]);
    expect(r.code).toBe(0);
    const files = readdirSync(outDir).filter((f) => f.endsWith("-monthly.md"));
    expect(files).toHaveLength(1);
    const md = readFileSync(join(outDir, files[0]), "utf8");
    expect(md).toContain("(unnamed #");
    expect(md).toContain("-pivot.md");
    expect(md).not.toContain("null");
  });

  test("weekly report also writes to --out", () => {
    const r = runScript(DB, "report.ts", ["--mode", "weekly", "--out", outDir]);
    expect(r.code).toBe(0);
    expect(readdirSync(outDir).some((f) => f.endsWith("-weekly.md"))).toBe(true);
  });
});

describe("gbrain-sync.ts", () => {
  test("passes title and tier to gbrain as discrete arguments, never through a shell", () => {
    const r = runScript(DB, "gbrain-sync.ts", [], { PATH: `${binDir}:${process.env.PATH ?? ""}` });
    expect(r.code).toBe(0);
    expect(r.out).toContain("synced 2/2");
    expect(existsSync(join(scratch, "owned"))).toBe(false);
    const argv = readFileSync(join(scratch, "argv"), "utf8");
    expect(argv).toContain("--title\nLiuxiaopaiMining_evil-touch-");
    expect(argv).toContain("--title\nLiuxiaopaiMining_unnamed-");
  });
});
