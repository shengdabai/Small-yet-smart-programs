import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { makeProject } from "./helpers/run.ts";

const project = makeProject();
const reportsDir = join(project.dir, "reports");
const SLOW_TEST_MS = 60_000;

beforeAll(() => {
  project.seed([
    // A ⭐⭐⭐ candidate with no name at all (sources may store NULL).
    { source: "toolify", external_id: "noname", url: "https://example.com/x", signal_score: 3, scored: { total: 29, tier: "⭐⭐⭐" } },
    // builtwith enrichment creates a scored row with no total before the 7-dimension scoring has run.
    { source: "toolify", external_id: "enriched", name: "Enriched", url: "https://example.com/e", scored: { total: null, tier: null } },
  ]);
}, SLOW_TEST_MS);

afterAll(() => project.cleanup());

describe("report.ts", () => {
  test("monthly report survives a ⭐⭐⭐ candidate whose name is NULL", () => {
    const r = project.run("report.ts", ["--mode", "monthly"]);
    expect(r.code).toBe(0);
    const files = readdirSync(reportsDir).filter((f) => f.endsWith("-monthly.md"));
    expect(files).toHaveLength(1);
    const md = readFileSync(join(reportsDir, files[0]), "utf8");
    expect(md).toContain("(unnamed #");
    expect(md).toContain("-pivot.md");
    expect(md).not.toContain("null");
  }, SLOW_TEST_MS);

  test("without --mode the first argument is not read as the mode", () => {
    const before = existsSync(reportsDir) ? readdirSync(reportsDir).filter((f) => f.endsWith("-weekly.md")).length : 0;
    const r = project.run("report.ts", ["monthly"]);
    expect(r.code).toBe(0);
    expect(readdirSync(reportsDir).filter((f) => f.endsWith("-weekly.md"))).toHaveLength(before + 1);
  }, SLOW_TEST_MS);
});

describe("db.ts --stats", () => {
  test("counts only scored rows that have a real total", () => {
    const r = project.run("db.ts", ["--stats"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("candidates=2  scored=1  ⭐⭐⭐=1");
  }, SLOW_TEST_MS);
});
