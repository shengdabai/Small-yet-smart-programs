/**
 * Finds the tools on Toolify's ranking page. No database or Firecrawl import, so it can be tested alone.
 *
 * Cloudflare blocks plain requests to toolify.ai, so the page goes through Firecrawl.
 * "auto" starts with the basic proxy (1 credit in the 2026-11 test) and pays for stealth only if basic fails.
 * The old /category/most-monthly-visits page now answers 404; this page is the same ranking by visits.
 */
export const TOOLIFY_LIST_URL = "https://www.toolify.ai/Best-trending-AI-Tools";

const TOOL_LINK = /^https?:\/\/(?:www\.)?toolify\.ai\/tool\/([a-z0-9-]+)\/?$/;

type LinksScrape = (
  url: string,
  opts: { formats: ["links"]; proxy: "auto" },
) => Promise<{
  success: boolean;
  error?: string;
  data?: { links?: string[]; metadata?: Record<string, unknown> };
}>;

/** Tool slugs in page order, without duplicates. */
export function extractToolSlugs(links: string[]): string[] {
  const slugs = new Set<string>();
  for (const link of links) {
    const m = TOOL_LINK.exec(link);
    if (m) slugs.add(m[1]);
  }
  return [...slugs];
}

/** Throws when the page is gone or has no tools, so a redesign shows up in the brief as a failure. */
export async function scrapeToolSlugs(scrape: LinksScrape): Promise<string[]> {
  const r = await scrape(TOOLIFY_LIST_URL, { formats: ["links"], proxy: "auto" });
  if (!r.success) throw new Error(r.error ?? "firecrawl error");
  const status = r.data?.metadata?.statusCode;
  if (typeof status === "number" && status >= 400) throw new Error(`HTTP ${status}`);
  const slugs = extractToolSlugs(r.data?.links ?? []);
  if (slugs.length === 0) throw new Error("no /tool/ links on the page");
  return slugs;
}
