/**
 * Toolify.ai 采集器
 *
 * 对应 v5 §03 Toolify 信号源:
 *   - 按访问量排名的榜单,取前 30 个工具
 *   - 无官方公开 API,Cloudflare 拦普通请求,所以经 Firecrawl 取页面链接(见 toolify-links.ts)
 *
 * 取不到就记一行 unreachable 并返回 0,不阻塞 pipeline;日报降级说明读这一行。
 */
import { upsertCandidate } from "../db.ts";
import { scrapeToolSlugs } from "./toolify-links.ts";

export async function fetchToolify(): Promise<number> {
  let slugs: string[];
  try {
    // Imported here because client.ts throws at import time when the Firecrawl key is missing.
    const { fcScrape } = await import("../firecrawl/client.ts");
    slugs = await scrapeToolSlugs(fcScrape);
  } catch (e) {
    console.warn(`[toolify] unreachable — ${(e as Error).message}`);
    return 0;
  }

  let newCount = 0;
  for (const slug of slugs.slice(0, 30)) {
    const { is_new } = upsertCandidate({
      source: "toolify",
      external_id: slug,
      name: slug.replace(/-/g, " "),
      url: `https://www.toolify.ai/tool/${slug}`,
      title: slug.replace(/-/g, " "),
      description: "",
      signal_score: 5, // 进了榜单就给基线,后续 enrich 时补 visits
      raw_payload: { slug },
    });
    if (is_new) newCount++;
  }

  console.log(`[toolify] tools_found=${slugs.length}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchToolify();
}
