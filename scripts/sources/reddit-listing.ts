/**
 * Fetches one subreddit listing. No database or Firecrawl import, so it can be tested alone.
 *
 * Main path: the rdt CLI with its saved login. The public .json endpoint now answers 403,
 * with and without the proxy. rdt only reads listings here.
 * Fallback: the public .json endpoint, so the scan still works if rdt is missing or logged out.
 * RSS is not used: it has no score, and it answers 429 from the second board on.
 *
 * rdt stdout contains a session value (modhash). Never log or rethrow stdout.
 * When every board falls back and fails, check the login with `rdt status`.
 */
import { homedir } from "node:os";
import { join } from "node:path";

const UA = "smart-programs-research/0.1 (public data research)";
// rdt can spend up to 30 s trying to refresh its cookie from the browser before the request.
const RDT_TIMEOUT_MS = 60_000;
// Normal cost is about 2 s per board. Past this total the run stops trying rdt, so a stuck rdt
// cannot use up the time limit of the whole scan (480 s in daily-scan.sh).
const RDT_BUDGET_MS = 120_000;

export type RedditSort = "top" | "hot" | "new";

export type RedditPost = {
  data: {
    id: string;
    title: string;
    selftext: string;
    url: string;
    permalink: string;
    score: number;
    num_comments: number;
    author: string;
    created_utc: number;
    subreddit: string;
    over_18: boolean;
  };
};

/** rdt --json prints { ok, data: { kind: "Listing", data: { children: [...] } } }. */
export function parseRdtListing(stdout: string): RedditPost[] {
  let parsed: { ok?: boolean; data?: { data?: { children?: RedditPost[] } } } | null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("rdt output is not JSON");
  }
  const children = parsed?.data?.data?.children;
  if (parsed?.ok !== true || !Array.isArray(children)) throw new Error("rdt output has no listing");
  return children;
}

async function fetchViaRdt(path: string, sort: RedditSort, time: string, timeoutMs: number): Promise<RedditPost[]> {
  const bin = process.env.RDT_BIN || join(homedir(), ".local/bin/rdt");
  const name = path.replace(/^\/r\//, "");
  const proc = Bun.spawn({
    cmd: [bin, "sub", name, "--sort", sort, "--time", time, "--limit", "100", "--json"],
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The limit also covers a child process that keeps stdout open after rdt itself is killed.
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("rdt timed out"));
    }, timeoutMs);
  });
  try {
    const [stdout, exitCode] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), proc.exited]),
      limit,
    ]);
    if (exitCode !== 0) throw new Error(`rdt exit ${exitCode}`);
    return parseRdtListing(stdout);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaPublicJson(path: string, sort: RedditSort, time: string): Promise<RedditPost[]> {
  const url = `https://www.reddit.com${path}/${sort}.json?t=${time}&limit=100`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  // daily-scan.sh reads the HTTP status from the last word of the "skip:" log line.
  if (!res.ok) throw new Error(`Reddit ${url} ${res.status}`);
  const json = (await res.json()) as { data: { children: RedditPost[] } };
  return json.data.children;
}

export type ListingFetcher = (path: string, sort: RedditSort, time: string) => Promise<RedditPost[]>;

/** One fetcher per scan: it counts the time spent in rdt across all boards of that scan. */
export function createListingFetcher(timeoutMs: number = RDT_TIMEOUT_MS, budgetMs: number = RDT_BUDGET_MS): ListingFetcher {
  let spentMs = 0;
  return async (path, sort, time) => {
    if (spentMs < budgetMs) {
      const started = Date.now();
      try {
        return await fetchViaRdt(path, sort, time, Math.min(timeoutMs, budgetMs - spentMs));
      } catch (e) {
        console.warn(`[reddit] ${path} rdt failed (${(e as Error).message}), trying the public endpoint`);
      } finally {
        spentMs += Date.now() - started;
      }
    }
    return fetchViaPublicJson(path, sort, time);
  };
}
