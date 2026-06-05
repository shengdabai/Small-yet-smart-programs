/**
 * Acquire.com 公开挂牌采集器
 *
 * 对应 v5 §04 Tier 2:Microns / Acquire 二手 SaaS 市场。
 *   - 卖家必须公开 MRR/客户数 → 数据真实度高
 *   - 是"已 PMF 但闷声"小 SaaS 最集中的地方
 *
 * Acquire.com 公开列表页用 Firecrawl 抓。
 */
import { upsertCandidate } from "../db.ts";
import { fcScrapeJson } from "../firecrawl/client.ts";

type AcEntry = {
  name?: string;
  url?: string;
  slug?: string;
  category?: string;
  asking_price?: string;
  mrr?: string;
  arr?: string;
  age?: string;
  description?: string;
  tech_stack?: string;
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
          url: { type: "string" },
          slug: { type: "string" },
          category: { type: "string" },
          asking_price: { type: "string" },
          mrr: { type: "string" },
          arr: { type: "string" },
          age: { type: "string" },
          description: { type: "string" },
          tech_stack: { type: "string" },
        },
      },
    },
  },
};

const PROMPT = `Extract SaaS / startup listings from this Acquire.com page.
For each listing return:
- name (business / product name; if anonymized return the anonymized label)
- url (absolute link to the listing detail page)
- slug (just the trailing slug from URL)
- category (e.g. "AI", "B2B SaaS", "Developer Tools", "E-commerce")
- asking_price (raw text like "$50k", "$120,000", "negotiable")
- mrr (raw text like "$3k/mo")
- arr (raw text like "$36k/yr")
- age (business age like "2 years", "8 months")
- description (1-2 sentence summary)
- tech_stack (technologies if mentioned)

Return at least 15 listings. Skip ads and category headers.`;

function parseMoney(text: string | undefined): number | null {
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

export async function fetchAcquire(): Promise<number> {
  const urls = [
    "https://acquire.com/browse",
    "https://acquire.com/browse/saas",
  ];

  let newCount = 0;
  let totalExtracted = 0;

  for (const url of urls) {
    try {
      const data = await fcScrapeJson<{ listings?: AcEntry[] }>(url, PROMPT, SCHEMA, {
        waitFor: 6000,
        proxy: "stealth",
        onlyMainContent: true,
      });
      const items = data?.listings ?? [];
      totalExtracted += items.length;

      for (const a of items) {
        if (!a.name) continue;
        const id = a.slug || a.url?.replace(/^https?:\/\/[^/]+\//, "") || a.name;
        const idSlug = id.replace(/\W+/g, "-").slice(0, 80);
        const mrr = parseMoney(a.mrr);
        const price = parseMoney(a.asking_price);

        const { is_new } = upsertCandidate({
          source: "acquire",
          external_id: idSlug,
          name: a.name.slice(0, 100),
          url: a.url || `https://acquire.com/${idSlug}`,
          title: `[${a.category ?? "SaaS"}] ${a.name}`,
          description: `${a.description ?? ""}${a.tech_stack ? ` Tech: ${a.tech_stack}` : ""}${a.age ? ` Age: ${a.age}` : ""}`.slice(0, 800),
          signal_score: mrr ?? 30,
          raw_payload: {
            mrr,
            arr: a.arr,
            asking_price: a.asking_price,
            price_numeric: price,
            category: a.category,
            tech_stack: a.tech_stack,
            age: a.age,
            source_url: url,
          },
        });
        if (is_new) newCount++;
      }
    } catch (e) {
      console.warn(`[acquire] ${url} 失败:`, (e as Error).message);
    }
  }

  console.log(`[acquire] firecrawl extracted=${totalExtracted}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchAcquire();
}
