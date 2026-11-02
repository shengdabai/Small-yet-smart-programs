import { afterAll, describe, expect, test } from "bun:test";
import { makeProject } from "./helpers/run.ts";

// makeProject() runs each case with a fake HOME and no key in the environment, so the "no key configured" path is
// exercised without touching the operator's real key file or the real database. The sources import db.ts, which opens
// its database at import time, so this cannot run in the test process. Assertions below never print a key value.
const project = makeProject();
afterAll(() => project.cleanup());

describe("firecrawl client without an API key", () => {
  test("importing the client and its dependants does not throw", () => {
    // pipeline.ts pulls these in for the monthly mode; the daily mode must still boot.
    const r = project.evaluate(`
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
    const r = project.evaluate(`
      const { fcScrape, fcScrapeJson } = await import("./scripts/firecrawl/client.ts");
      let networkCalls = 0;
      globalThis.fetch = async () => { networkCalls += 1; return new Response("{}", { status: 200 }); };
      const scrape = await fcScrape("https://example.com");
      const json = await fcScrapeJson("https://example.com", "p", {});
      console.log(JSON.stringify({
        success: scrape.success,
        namesTheKey: /FIRECRAWL_API_KEY missing/.test(scrape.error ?? ""),
        json,
        networkCalls,
      }));
    `);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out.trim().split("\n").at(-1) ?? "{}")).toEqual({
      success: false,
      namesTheKey: true,
      json: null,
      networkCalls: 0,
    });
  }, 60_000);
});
