import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./helpers/run.ts";

// Each case runs in a subprocess with no key in its environment and a key-file path that does not exist, so the
// "no key configured" path is exercised without touching the operator's real key file or the real database.
// The sources import db.ts, which opens its database at import time, so this cannot run in the test process.
// Assertions below never print a key value.
const scratch = mkdtempSync(join(tmpdir(), "smart-programs-firecrawl-"));
afterAll(() => rmSync(scratch, { force: true, recursive: true }));

function withoutKey(code: string) {
  const { FIRECRAWL_API_KEY: _key, ...env } = process.env;
  const proc = Bun.spawnSync({
    cmd: [process.execPath, "-e", code],
    cwd: ROOT,
    env: { ...env, SMART_PROGRAMS_DB: join(scratch, "miner.db"), FIRECRAWL_ENV_FILE: join(scratch, "missing.env") },
  });
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
}

describe("firecrawl client without an API key", () => {
  test("importing the client and its dependants does not throw", () => {
    // pipeline.ts pulls these in for the monthly mode; the daily mode must still boot.
    const r = withoutKey(`
      await import("./scripts/firecrawl/client.ts");
      await import("./scripts/sources/producthunt.ts");
      await import("./scripts/sources/indiehackers.ts");
      console.log("imported");
    `);
    expect(r.err).not.toContain("FIRECRAWL_API_KEY missing");
    expect(r.code).toBe(0);
    expect(r.out).toContain("imported");
  }, 60_000);

  test("fcScrape reports the missing key as an error result instead of throwing", () => {
    const r = withoutKey(`
      const { fcScrape, fcScrapeJson, loadKey } = await import("./scripts/firecrawl/client.ts");
      let threw = false;
      try { loadKey(); } catch (e) { threw = /FIRECRAWL_API_KEY missing/.test(e.message); }
      let networkCalls = 0;
      globalThis.fetch = async () => { networkCalls += 1; return new Response("{}", { status: 200 }); };
      const scrape = await fcScrape("https://example.com");
      const json = await fcScrapeJson("https://example.com", "p", {});
      console.log(JSON.stringify({
        threw,
        success: scrape.success,
        namesTheKey: /FIRECRAWL_API_KEY missing/.test(scrape.error ?? ""),
        json,
        networkCalls,
      }));
    `);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
      threw: true,
      success: false,
      namesTheKey: true,
      json: null,
      networkCalls: 0,
    });
  }, 60_000);
});
