/**
 * Firecrawl REST 客户端(绕过 MCP,直接调 API)
 *
 * 读 ~/.config/firecrawl/.env 拿 key,直接 fetch API。
 * 比 MCP 稳:不受 NVM lazy-load / MCP 启动顺序影响。
 *
 * 用法:
 *   const md = await fcScrape("https://...", { onlyMainContent: true });
 *   const data = await fcScrapeJson("https://...", { prompt, schema });
 */
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ENV_PATH = join(homedir(), ".config/firecrawl/.env");

function loadKey(): string {
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;
  if (existsSync(ENV_PATH)) {
    const txt = readFileSync(ENV_PATH, "utf8");
    const m = /^FIRECRAWL_API_KEY=(.+)$/m.exec(txt);
    if (m) return m[1].trim();
  }
  throw new Error("FIRECRAWL_API_KEY missing — set env var or ~/.config/firecrawl/.env");
}

const KEY = loadKey();
const BASE = "https://api.firecrawl.dev/v1";

export type ScrapeOpts = {
  formats?: ("markdown" | "html" | "json" | "links")[];
  onlyMainContent?: boolean;
  waitFor?: number;
  proxy?: "basic" | "stealth" | "enhanced" | "auto";
  jsonOptions?: {
    prompt?: string;
    schema?: object;
  };
  maxAge?: number;
};

type FcResp<T = unknown> = {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    json?: T;
    links?: string[];
    metadata?: Record<string, unknown>;
  };
  error?: string;
};

export async function fcScrape(url: string, opts: ScrapeOpts = {}): Promise<FcResp> {
  const body = {
    url,
    formats: opts.formats ?? ["markdown"],
    onlyMainContent: opts.onlyMainContent ?? true,
    waitFor: opts.waitFor ?? 4000,
    proxy: opts.proxy ?? "stealth",
    ...(opts.jsonOptions && { jsonOptions: opts.jsonOptions }),
    ...(opts.maxAge !== undefined && { maxAge: opts.maxAge }),
  };
  const res = await fetch(`${BASE}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    return { success: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  return (await res.json()) as FcResp;
}

export async function fcScrapeMarkdown(url: string, opts: Omit<ScrapeOpts, "formats"> = {}): Promise<string | null> {
  const r = await fcScrape(url, { ...opts, formats: ["markdown"] });
  if (!r.success || !r.data?.markdown) return null;
  return r.data.markdown;
}

export async function fcScrapeJson<T = unknown>(
  url: string,
  prompt: string,
  schema: object,
  opts: Omit<ScrapeOpts, "formats" | "jsonOptions"> = {},
): Promise<T | null> {
  const r = await fcScrape(url, {
    ...opts,
    formats: ["json"],
    jsonOptions: { prompt, schema },
  });
  if (!r.success || !r.data?.json) return null;
  return r.data.json as T;
}

if (import.meta.main) {
  const md = await fcScrapeMarkdown("https://example.com");
  console.error("fcScrape smoke test:", md ? "OK" : "FAIL");
}
