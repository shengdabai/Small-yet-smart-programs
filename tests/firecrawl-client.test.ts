import { describe, expect, test } from "bun:test";

// tests/setup.ts (bunfig preload) points FIRECRAWL_ENV_FILE at a file that does
// not exist and clears FIRECRAWL_API_KEY, so the "no key configured" path is
// exercised without touching the operator's real ~/.config/firecrawl/.env.
// Assertions below never print a key value.

describe("firecrawl client without an API key", () => {
  test("importing the client and its dependants does not throw", async () => {
    await expect(import("../scripts/firecrawl/client.ts")).resolves.toBeDefined();
    // pipeline.ts pulls these in for the monthly mode; the daily mode must still boot.
    await expect(import("../scripts/sources/producthunt.ts")).resolves.toBeDefined();
    await expect(import("../scripts/sources/indiehackers.ts")).resolves.toBeDefined();
  });

  test("fcScrape reports the missing key as an error result instead of throwing", async () => {
    const { fcScrape, fcScrapeJson, loadKey } = await import("../scripts/firecrawl/client.ts");
    let threw = false;
    try {
      loadKey();
    } catch (e) {
      threw = /FIRECRAWL_API_KEY missing/.test((e as Error).message);
    }
    expect(threw).toBe(true);

    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      const r = await fcScrape("https://example.com");
      expect(r.success).toBe(false);
      expect(/FIRECRAWL_API_KEY missing/.test(r.error ?? "")).toBe(true);
      expect(await fcScrapeJson("https://example.com", "p", {})).toBeNull();
      expect(networkCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
