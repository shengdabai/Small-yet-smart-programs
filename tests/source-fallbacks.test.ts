import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createListingFetcher, parseRdtListing, type RedditPost } from "../scripts/sources/reddit-listing.ts";
import { extractToolSlugs, scrapeToolSlugs, TOOLIFY_LIST_URL } from "../scripts/sources/toolify-links.ts";

// Everything here is local: rdt is a stub script, fetch is replaced, Firecrawl is an injected function.
// These modules do not import db.ts, so no test touches a database.

const dir = mkdtempSync(join(tmpdir(), "smart-programs-sources-"));
const argsFile = join(dir, "rdt-args");
const realFetch = globalThis.fetch;
const realRdtBin = process.env.RDT_BIN;

afterAll(() => {
  rmSync(dir, { force: true, recursive: true });
  globalThis.fetch = realFetch;
  if (realRdtBin === undefined) delete process.env.RDT_BIN;
  else process.env.RDT_BIN = realRdtBin;
});

const post = (id: string): RedditPost => ({
  data: {
    id,
    title: `Post ${id}`,
    selftext: "body",
    url: "https://example.com",
    permalink: `/r/SaaS/comments/${id}/`,
    score: 42,
    num_comments: 3,
    author: "someone",
    created_utc: 1,
    subreddit: "SaaS",
    over_18: false,
  },
});
const rdtOutput = (posts: RedditPost[]) =>
  JSON.stringify({ ok: true, schema_version: "1", data: { kind: "Listing", data: { modhash: "SECRET", children: posts } } });

function fakeRdt(body: string) {
  const path = join(dir, `rdt-${crypto.randomUUID()}`);
  writeFileSync(path, `#!/bin/bash\nprintf '%s\\n' "$*" >> "${argsFile}"\n${body}\n`);
  chmodSync(path, 0o755);
  process.env.RDT_BIN = path;
}
function rdtPrints(text: string) {
  const out = join(dir, `out-${crypto.randomUUID()}`);
  writeFileSync(out, text);
  fakeRdt(`cat "${out}"`);
}

let fetched: string[] = [];
function fetchAnswers(status: number, body: unknown = {}) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    fetched.push(String(url));
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

beforeEach(() => {
  fetched = [];
  rmSync(argsFile, { force: true });
  fetchAnswers(500);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseRdtListing", () => {
  test("reads the posts out of the rdt envelope", () => {
    expect(parseRdtListing(rdtOutput([post("a"), post("b")])).map((p) => p.data.id)).toEqual(["a", "b"]);
  });

  test("rejects an rdt error envelope", () => {
    expect(() => parseRdtListing(JSON.stringify({ ok: false, error: { code: "not_authenticated" } }))).toThrow("no listing");
    expect(() => parseRdtListing("null")).toThrow("no listing");
  });

  test("a parse failure does not repeat stdout, which can hold the session value", () => {
    let message = "";
    try {
      parseRdtListing('{"modhash":"SECRET", broken');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toBe("rdt output is not JSON");
  });
});

describe("createListingFetcher", () => {
  const fetchListing = (path: string, sort: "top", time: string) => createListingFetcher()(path, sort, time);

  test("uses rdt and does not touch the public endpoint when rdt works", async () => {
    rdtPrints(rdtOutput([post("a")]));
    const posts = await fetchListing("/r/SaaS", "top", "month");
    expect(posts.map((p) => p.data.id)).toEqual(["a"]);
    expect(readFileSync(argsFile, "utf8").trim()).toBe("sub SaaS --sort top --time month --limit 100 --json");
    expect(fetched).toEqual([]);
  });

  test("falls back to the public endpoint when rdt exits non-zero", async () => {
    fakeRdt("exit 1");
    fetchAnswers(200, { data: { children: [post("b")] } });
    const posts = await fetchListing("/r/SaaS", "top", "week");
    expect(posts.map((p) => p.data.id)).toEqual(["b"]);
    expect(fetched).toEqual(["https://www.reddit.com/r/SaaS/top.json?t=week&limit=100"]);
  });

  test("falls back when the rdt binary is missing", async () => {
    process.env.RDT_BIN = join(dir, "does-not-exist");
    fetchAnswers(200, { data: { children: [post("c")] } });
    expect((await fetchListing("/r/SaaS", "top", "week")).map((p) => p.data.id)).toEqual(["c"]);
  });

  test("falls back when rdt prints something that is not a listing", async () => {
    rdtPrints("Cookie refresh failed");
    fetchAnswers(200, { data: { children: [post("d")] } });
    expect((await fetchListing("/r/SaaS", "top", "week")).map((p) => p.data.id)).toEqual(["d"]);
  });

  test("a hanging rdt is killed at the time limit and the scan continues", async () => {
    fakeRdt("exec sleep 30");
    fetchAnswers(200, { data: { children: [post("e")] } });
    const started = Date.now();
    const posts = await createListingFetcher(200)("/r/SaaS", "top", "week");
    expect(posts.map((p) => p.data.id)).toEqual(["e"]);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test("the time limit also holds when a child of rdt keeps stdout open", async () => {
    fakeRdt("sleep 30");
    fetchAnswers(200, { data: { children: [post("f")] } });
    const started = Date.now();
    const posts = await createListingFetcher(200)("/r/SaaS", "top", "week");
    expect(posts.map((p) => p.data.id)).toEqual(["f"]);
    expect(Date.now() - started).toBeLessThan(4000);
  });

  test("other work keeps running while rdt is busy", async () => {
    rdtPrints(rdtOutput([post("g")]));
    fakeRdt(`sleep 0.3\necho '${rdtOutput([post("g")])}'`);
    let ticks = 0;
    const ticker = setInterval(() => ticks++, 10);
    await createListingFetcher()("/r/SaaS", "top", "week");
    clearInterval(ticker);
    expect(ticks).toBeGreaterThan(5);
  });

  test("once the rdt budget is used up, the remaining boards skip rdt", async () => {
    fakeRdt("exec sleep 30");
    fetchAnswers(200, { data: { children: [post("h")] } });
    const fetchBoard = createListingFetcher(100, 150);
    await fetchBoard("/r/a", "top", "week"); // times out at 100 ms
    await fetchBoard("/r/b", "top", "week"); // times out at the remaining 50 ms
    const callsBefore = readFileSync(argsFile, "utf8").trim().split("\n").length;
    const started = Date.now();
    await fetchBoard("/r/c", "top", "week");
    expect(Date.now() - started).toBeLessThan(90);
    expect(readFileSync(argsFile, "utf8").trim().split("\n").length).toBe(callsBefore);
    expect(fetched.length).toBe(3);
  });

  test("a quick rdt failure on one board does not stop rdt for the next board", async () => {
    fakeRdt("exit 1");
    fetchAnswers(200, { data: { children: [post("i")] } });
    const fetchBoard = createListingFetcher();
    await fetchBoard("/r/a", "top", "week");
    rdtPrints(rdtOutput([post("j")]));
    expect((await fetchBoard("/r/b", "top", "week")).map((p) => p.data.id)).toEqual(["j"]);
  });

  test("when both paths fail, the error ends with the HTTP status that daily-scan.sh reads", async () => {
    fakeRdt("exit 1");
    fetchAnswers(403);
    await expect(fetchListing("/r/SaaS", "top", "week")).rejects.toThrow(/ 403$/);
  });
});

describe("extractToolSlugs", () => {
  test("keeps tool links in page order, once each, and ignores everything else", () => {
    expect(
      extractToolSlugs([
        "https://www.toolify.ai/Best-trending-AI-Tools/Best-ai-tools-in-September-2026",
        "https://www.toolify.ai/tool/chatgpt-4",
        "https://www.toolify.ai/tool/claude-2/",
        "https://www.toolify.ai/tool/chatgpt-4",
        "https://www.toolify.ai/tool/%E7%BE%8E%E5%9B%BE",
        "https://example.com/tool/not-toolify",
        "https://twitter.com/intent/tweet?url=https://www.toolify.ai/tool/shared",
      ]),
    ).toEqual(["chatgpt-4", "claude-2"]);
  });
});

describe("scrapeToolSlugs", () => {
  const answer = (r: Awaited<ReturnType<Parameters<typeof scrapeToolSlugs>[0]>>) => async () => r;

  test("asks for the ranking page's links without forcing the stealth proxy", async () => {
    const calls: unknown[][] = [];
    const slugs = await scrapeToolSlugs(async (...args) => {
      calls.push(args);
      return { success: true, data: { links: ["https://www.toolify.ai/tool/a"], metadata: { statusCode: 200 } } };
    });
    expect(slugs).toEqual(["a"]);
    expect(calls).toEqual([[TOOLIFY_LIST_URL, { formats: ["links"], proxy: "auto" }]]);
  });

  test("a page that is gone is a failure, even when Firecrawl itself succeeded", async () => {
    await expect(
      scrapeToolSlugs(answer({ success: true, data: { links: ["https://www.toolify.ai/tool/a"], metadata: { statusCode: 404 } } })),
    ).rejects.toThrow("HTTP 404");
  });

  test("a page without tool links is a failure, not an empty success", async () => {
    await expect(scrapeToolSlugs(answer({ success: true, data: { links: ["https://www.toolify.ai/new"] } }))).rejects.toThrow("no /tool/ links");
  });

  test("a Firecrawl error is passed on", async () => {
    await expect(scrapeToolSlugs(answer({ success: false, error: "HTTP 402: out of credits" }))).rejects.toThrow("402");
  });
});
