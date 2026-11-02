/**
 * Reddit r/SideProject + r/SaaS 采集器
 *
 * 对应 v5 §03 Reddit 信号源:
 *   - r/SideProject 每周 top
 *   - r/SaaS 用关键词搜 "wish there was a tool for"(需求清单)
 *   - 取数通路(rdt CLI 优先,公开 .json 兜底)见 reddit-listing.ts
 */
import { upsertCandidate } from "../db.ts";
import { createListingFetcher, type ListingFetcher } from "./reddit-listing.ts";

async function fetchSub(fetchListing: ListingFetcher, path: string, sort: "top" | "hot" | "new", time: string, min_score: number) {
  const children = await fetchListing(path, sort, time);

  let newCount = 0;
  for (const { data: p } of children) {
    if (p.over_18) continue;
    if (p.score < min_score) continue;

    // 提取 URL: selftext post 没外链就用 permalink
    const externalUrl = p.url && !p.url.includes("reddit.com") ? p.url : `https://www.reddit.com${p.permalink}`;
    const name = p.title.split(/[—–-]/)[0].split(":")[0].trim().slice(0, 80);

    const { is_new } = upsertCandidate({
      source: `reddit/${p.subreddit}`,
      external_id: p.id,
      name,
      url: externalUrl,
      title: p.title,
      description: p.selftext.slice(0, 1000),
      signal_score: p.score,
      raw_payload: {
        score: p.score,
        comments: p.num_comments,
        author: p.author,
        created_utc: p.created_utc,
        subreddit: p.subreddit,
        permalink: `https://www.reddit.com${p.permalink}`,
      },
    });
    if (is_new) newCount++;
  }
  return { fetched: children.length, newCount };
}

export async function fetchReddit(): Promise<number> {
  let total = 0;
  const fetchListing = createListingFetcher();

  // 7 个 sub × top/week,覆盖 v5 §03 提到的"原始用户声音 + 痛点 + 需求清单"
  const subs: Array<{ path: string; min: number; t?: string }> = [
    { path: "/r/SideProject", min: 50 },                  // builder 展示
    { path: "/r/SaaS", min: 30 },                          // SaaS 圈讨论
    { path: "/r/microsaas", min: 20 },                     // 闷声小 SaaS
    { path: "/r/Entrepreneur", min: 100 },                 // 创业者大圈
    { path: "/r/EntrepreneurRideAlong", min: 30 },         // 实操日记
    { path: "/r/sidehustle", min: 50 },                    // 副业(找痛点)
    { path: "/r/indiehackers", min: 20 },                  // IH 镜像
    { path: "/r/digitalnomad", min: 50, t: "month" },      // 远程工具需求
    { path: "/r/SaaSSales", min: 10 },                     // SaaS 销售方
  ];

  for (const s of subs) {
    try {
      const r = await fetchSub(fetchListing, s.path, "top", s.t ?? "week", s.min);
      console.log(`[reddit] ${s.path} fetched=${r.fetched} new=${r.newCount}`);
      total += r.newCount;
    } catch (e) {
      console.warn(`[reddit] ${s.path} skip:`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 300)); // Reddit 限速
  }

  return total;
}

if (import.meta.main) {
  await fetchReddit();
}
