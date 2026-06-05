/**
 * Product Hunt 采集器 v2(Firecrawl JSON 抽取)
 *
 * 对应 v5 §03:不看 #1,看 10-50 名长尾(更可能闷声)。
 * 用 Firecrawl JSON mode 直接结构化抽取,绕过 MCP 直调 REST。
 */
import { upsertCandidate } from "../db.ts";
import { fcScrapeJson } from "../firecrawl/client.ts";

type PhProduct = {
  rank?: number;
  name: string;
  slug?: string;
  tagline?: string;
  upvotes?: number;
  url?: string;
  topic?: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "integer" },
          name: { type: "string" },
          slug: { type: "string" },
          tagline: { type: "string" },
          upvotes: { type: "integer" },
          url: { type: "string" },
          topic: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
};

const PROMPT = `Extract the products visible on this Product Hunt page.
For each product return:
- rank (1-based position on page, integer; if not shown use 0)
- name (product name)
- slug (URL slug from /posts/<slug>; just the slug, no prefix)
- tagline (one-line description below the name)
- upvotes (integer, number of upvotes)
- url (full absolute URL like https://www.producthunt.com/posts/<slug>)
- topic (primary topic/category if shown like "Productivity", "AI", "Developer Tools")

Return AT LEAST 20 products if visible. Skip ads, sponsor placements, and empty rows.`;

export async function fetchProductHunt(): Promise<number> {
  const urls = [
    "https://www.producthunt.com/",
    "https://www.producthunt.com/categories/saas",
    "https://www.producthunt.com/categories/productivity",
  ];

  let newCount = 0;
  let totalExtracted = 0;

  for (const url of urls) {
    try {
      const data = await fcScrapeJson<{ products?: PhProduct[] }>(url, PROMPT, SCHEMA, {
        waitFor: 5000,
        proxy: "stealth",
        onlyMainContent: true,
      });
      const products = data?.products ?? [];
      totalExtracted += products.length;

      for (const p of products) {
        if (!p.name) continue;
        const slug = p.slug || (p.url?.match(/\/posts\/([^/?#]+)/)?.[1]);
        if (!slug) continue;

        // v5 SOP: 跳过 rank 1-9 头部(若有 rank 数据);否则全收
        if (p.rank && p.rank > 0 && p.rank < 10) continue;

        const { is_new } = upsertCandidate({
          source: "producthunt",
          external_id: slug,
          name: p.name.slice(0, 100),
          url: p.url || `https://www.producthunt.com/posts/${slug}`,
          title: `${p.name} — ${p.tagline ?? ""}`.slice(0, 200),
          description: p.tagline ?? "",
          signal_score: p.upvotes ?? 20,
          raw_payload: { rank: p.rank, topic: p.topic, source_url: url },
        });
        if (is_new) newCount++;
      }
    } catch (e) {
      console.warn(`[producthunt] ${url} 失败:`, (e as Error).message);
    }
  }

  console.log(`[producthunt] firecrawl extracted=${totalExtracted}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchProductHunt();
}
