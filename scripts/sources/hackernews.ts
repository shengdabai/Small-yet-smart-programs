/**
 * HackerNews Show HN 采集器
 *
 * 对应 v5 §03 Show HN 信号源:
 *   - 近 30 天 launch
 *   - 筛 upvote ≥ 50(v5 SOP)
 *   - 用 Algolia HN Search API,完全公开免费,无需 key
 *
 * https://hn.algolia.com/api
 */
import { upsertCandidate } from "../db.ts";

const MIN_POINTS = 50;
const WINDOW_DAYS = 30;

type HnHit = {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
  num_comments: number;
  author: string;
  created_at: string;
  story_text: string | null;
};

export async function fetchHackerNews(): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400;
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("tags", "show_hn");
  url.searchParams.set("numericFilters", `created_at_i>${since},points>=${MIN_POINTS}`);
  url.searchParams.set("hitsPerPage", "100");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HN API ${res.status}`);
  const json = (await res.json()) as { hits: HnHit[] };

  let newCount = 0;
  for (const h of json.hits) {
    const name = h.title.replace(/^Show HN:\s*/i, "").split("—")[0].split(" - ")[0].trim();
    const { is_new } = upsertCandidate({
      source: "hackernews",
      external_id: h.objectID,
      name,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
      title: h.title,
      description: h.story_text ?? "",
      signal_score: h.points,
      raw_payload: {
        points: h.points,
        comments: h.num_comments,
        author: h.author,
        created_at: h.created_at,
      },
    });
    if (is_new) newCount++;
  }

  console.log(`[hackernews] fetched=${json.hits.length}  new=${newCount}  threshold=${MIN_POINTS}pts/${WINDOW_DAYS}d`);
  return newCount;
}

if (import.meta.main) {
  await fetchHackerNews();
}
