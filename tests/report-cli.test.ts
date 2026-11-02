import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript, seed } from "./helpers/run.ts";

const scratch = mkdtempSync(join(tmpdir(), "smart-programs-report-"));
const DB = join(scratch, "miner.db");
const outDir = join(scratch, "reports");

beforeAll(() => {
  // A ⭐⭐⭐ candidate with no name at all (sources may store NULL).
  seed(DB, [
    { source: "toolify", external_id: "noname", url: "https://example.com/x", signal_score: 3, scored: { total: 29, tier: "⭐⭐⭐" } },
  ]);
  Bun.spawnSync({ cmd: ["mkdir", "-p", outDir] });
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
