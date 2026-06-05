/**
 * Microns.io 小 SaaS 二手市场
 *
 * v5 §04 Tier 2 同款,补充 Acquire 的小 ticket 段(MRR <$5k)。
 */
import { upsertCandidate } from "../db.ts";
import { fcScrapeJson } from "../firecrawl/client.ts";

type MicronListing = {
  name?: string;
  slug?: string;
  url?: string;
  price?: string;
  mrr?: string;
  category?: string;
  description?: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    listings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          url: { type: "string" },
          price: { type: "string" },
          mrr: { type: "string" },
          category: { type: "string" },
          description: { type: "string" },
        },
      },
    },
  },
};

const PROMPT = `Extract micro-SaaS listings from this Microns.io marketplace page.
For each: name, slug (from URL), url (absolute), price (asking price), mrr, category, description (1-2 sentences). At least 10 entries.`;

function parseMoney(text?: string): number | null {
  if (!text) return null;
  const m = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|K|m|M)?/.exec(text);
  if (!m) return null;
  let val = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) {
    if (/k/i.test(m[2])) val *= 1000;
    if (/m/i.test(m[2])) val *= 1_000_000;
  }
  return val;
}

export async function fetchMicrons(): Promise<number> {
  try {
    const data = await fcScrapeJson<{ listings?: MicronListing[] }>(
      "https://microns.io/",
      PROMPT,
      SCHEMA,
      { waitFor: 5000, proxy: "stealth", onlyMainContent: true },
    );
    const items = data?.listings ?? [];
    let newCount = 0;
    for (const m of items) {
      if (!m.name) continue;
      const id = (m.slug || m.url || m.name).replace(/^https?:\/\/[^/]+\//, "").replace(/\W+/g, "-").slice(0, 80);
      const { is_new } = upsertCandidate({
        source: "microns",
        external_id: id,
        name: m.name.slice(0, 100),
        url: m.url || `https://microns.io/${id}`,
        title: `[${m.category ?? "Micro SaaS"}] ${m.name}`,
        description: m.description ?? "",
        signal_score: parseMoney(m.mrr) ?? 20,
        raw_payload: { mrr: m.mrr, price: m.price, category: m.category },
      });
      if (is_new) newCount++;
    }
    console.log(`[microns] extracted=${items.length}  new=${newCount}`);
    return newCount;
  } catch (e) {
    console.warn(`[microns] 失败:`, (e as Error).message);
    return 0;
  }
}

if (import.meta.main) {
  await fetchMicrons();
}
