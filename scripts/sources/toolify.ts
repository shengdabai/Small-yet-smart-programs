/**
 * Toolify.ai 采集器
 *
 * 对应 v5 §03 Toolify 信号源:
 *   - Hot Tools by Visits Growth top 20
 *   - 无官方公开 API,需抓 HTML
 *   - 用 Firecrawl MCP(用户已配)兜底,或简单 fetch + cheerio-lite
 *
 * 这里实现:fetch 首页 HTML,正则提取 tool 卡片(URL/name/visits)。
 * 抓不到就空数组,不阻塞 pipeline。
 */
import { upsertCandidate } from "../db.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export async function fetchToolify(): Promise<number> {
  // Toolify 排行榜公开页
  const urls = [
    "https://www.toolify.ai/category/most-monthly-visits",
    "https://www.toolify.ai/",
  ];

  let html = "";
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.ok) {
        html = await res.text();
        if (html.length > 5000) break;
      }
    } catch (e) {
      console.warn(`[toolify] ${url} failed:`, (e as Error).message);
    }
  }

  if (!html) {
    console.warn("[toolify] unreachable — 后续可走 Firecrawl MCP");
    return 0;
  }

  // 提取 /tool/<slug> 链接
  const slugRe = /href="\/tool\/([a-z0-9-]+)"/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = slugRe.exec(html))) {
    seen.add(m[1]);
  }

  let newCount = 0;
  for (const slug of [...seen].slice(0, 30)) {
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

  console.log(`[toolify] tools_found=${seen.size}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchToolify();
}
