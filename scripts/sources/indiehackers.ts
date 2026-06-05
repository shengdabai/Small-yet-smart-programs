/**
 * IndieHackers 采集器 v2(Firecrawl JSON 抽取)
 *
 * 对应 v5 §03:Milestones 频道 + Products 目录,
 *   筛 MRR $1k-50k(已验证 + 仍闷声)。
 */
import { upsertCandidate } from "../db.ts";
import { fcScrapeJson } from "../firecrawl/client.ts";

type IhEntry = {
  title?: string;
  product_name?: string;
  founder_name?: string;
  mrr_text?: string;
  description?: string;
  permalink?: string;
  upvotes?: number;
  date_text?: string;
};

const SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          product_name: { type: "string" },
          founder_name: { type: "string" },
          mrr_text: { type: "string" },
          description: { type: "string" },
          permalink: { type: "string" },
          upvotes: { type: "integer" },
          date_text: { type: "string" },
        },
      },
    },
  },
};

const PROMPT = `Extract entries from this IndieHackers page (milestones, products, or interviews).
For each return:
- title (entry title)
- product_name (product/SaaS name if mentioned)
- founder_name (founder/maker name if shown)
- mrr_text (raw revenue/MRR/ARR text like "$3.5k/mo", "$10k MRR", "$45/mo")
- description (1-2 sentence summary or excerpt)
- permalink (absolute URL like https://www.indiehackers.com/post/<slug> or /milestone/<slug> or /product/<slug>)
- upvotes (integer if shown)
- date_text (date or relative time if shown)

Return AT LEAST 20 entries. Prefer entries that mention concrete revenue numbers. Skip pure ads and login walls.`;

const MIN_MRR = 500;
const MAX_MRR = 50_000;

function extractMrr(text: string | undefined): number | null {
  if (!text) return null;
  const re = /\$\s*([\d,]+(?:\.\d+)?)\s*(k|K|\/mo|\s*MRR|\s*ARR|\s*monthly)?/gi;
  let best: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let val = parseFloat(m[1].replace(/,/g, ""));
    if (m[2] && /k/i.test(m[2])) val *= 1000;
    if (val >= MIN_MRR && val <= MAX_MRR) {
      if (best === null || val > best) best = val;
    }
  }
  return best;
}

export async function fetchIndieHackers(): Promise<number> {
  const urls = [
    "https://www.indiehackers.com/products",
    "https://www.indiehackers.com/milestones",
    "https://www.indiehackers.com/",
  ];

  let newCount = 0;
  let totalExtracted = 0;
  let inRange = 0;

  for (const url of urls) {
    try {
      const data = await fcScrapeJson<{ entries?: IhEntry[] }>(url, PROMPT, SCHEMA, {
        waitFor: 5000,
        proxy: "stealth",
        onlyMainContent: true,
      });
      const entries = data?.entries ?? [];
      totalExtracted += entries.length;

      for (const e of entries) {
        const combined = `${e.title ?? ""} ${e.mrr_text ?? ""} ${e.description ?? ""}`;
        const mrr = extractMrr(combined);

        // 没 MRR 数据但有产品名也收(后续 enrich 时再补)
        const id = e.permalink || e.product_name || e.title;
        if (!id) continue;

        const slug = id.replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "").replace(/\W+/g, "-").slice(0, 80);

        if (mrr) inRange++;

        const { is_new } = upsertCandidate({
          source: "indiehackers",
          external_id: slug,
          name: (e.product_name || e.title || "untitled").slice(0, 100),
          url: e.permalink || `https://www.indiehackers.com/${slug}`,
          title: e.title ?? "",
          description: `${e.description ?? ""}${e.founder_name ? ` (by ${e.founder_name})` : ""}`.slice(0, 800),
          signal_score: mrr ?? (e.upvotes ?? 10),
          raw_payload: {
            mrr,
            mrr_text: e.mrr_text,
            founder: e.founder_name,
            date_text: e.date_text,
            source_url: url,
          },
        });
        if (is_new) newCount++;
      }
    } catch (err) {
      console.warn(`[indiehackers] ${url} 失败:`, (err as Error).message);
    }
  }

  console.log(`[indiehackers] firecrawl extracted=${totalExtracted}  in_mrr_range=${inRange}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchIndieHackers();
}
