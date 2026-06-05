/**
 * SimilarWeb 公开页 traffic 估算
 *
 * 对应 v5 §03 SimilarWeb 免费版:
 *   - 输入网站,看月访问量 + 来源 + 国家分布
 *   - SimilarWeb 公开页 https://www.similarweb.com/website/<domain>/
 *
 * SimilarWeb 反爬严格,直接 fetch 经常拿到 403/Cloudflare Challenge。
 * 这里实现"轻量信号":只对 candidates 表里 url 字段有 domain 的、且还没有
 * traffic_snapshot 的产品,尝试抓一次。失败标记 skip,留给 Firecrawl 兜底。
 *
 * 这个 source 不"发现"新候选,而是"丰富"已有候选的 traffic 数据。
 */
import { db } from "../db.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const TODAY = new Date().toISOString().slice(0, 10);

function extractDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    // 排除聚合站,只对真实产品域名抓
    if (
      host.includes("reddit.com") ||
      host.includes("ycombinator.com") ||
      host.includes("producthunt.com") ||
      host.includes("indiehackers.com") ||
      host.includes("github.com") ||
      host.includes("redd.it")
    ) return null;
    return host;
  } catch {
    return null;
  }
}

async function fetchSwPage(domain: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.similarweb.com/website/${domain}/`, {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 5000) return null;
    return html;
  } catch {
    return null;
  }
}

function parseVisits(html: string): number | null {
  // SimilarWeb 公开页 visits 通常在 "websiteOverview" 或带 "Total Visits" 旁边
  // 形式 "1.2M" / "850K" / "5.6B"
  const re = /Total Visits[^0-9]*([\d.]+)\s*([KMB])/i;
  const m = re.exec(html);
  if (!m) return null;
  const num = parseFloat(m[1]);
  const mult = m[2].toUpperCase() === "B" ? 1e9 : m[2].toUpperCase() === "M" ? 1e6 : 1e3;
  return Math.round(num * mult);
}

const insertSnap = db.query(`
  INSERT INTO traffic_snapshots (candidate_id, snapshot_date, visits, raw_payload)
  VALUES ($cid, $date, $visits, $raw)
  ON CONFLICT(candidate_id, snapshot_date) DO UPDATE SET
    visits = excluded.visits,
    raw_payload = excluded.raw_payload
`);

export async function enrichSimilarWeb(opts: { limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 20;
  const rows = db
    .query(
      `SELECT c.id, c.url FROM candidates c
       LEFT JOIN traffic_snapshots t ON t.candidate_id = c.id AND t.snapshot_date = ?
       WHERE c.url IS NOT NULL AND t.candidate_id IS NULL
       ORDER BY c.signal_score DESC NULLS LAST
       LIMIT ?`,
    )
    .all(TODAY, limit) as { id: number; url: string }[];

  let enriched = 0;
  let skipped = 0;
  for (const row of rows) {
    const domain = extractDomain(row.url);
    if (!domain) {
      skipped++;
      continue;
    }
    const html = await fetchSwPage(domain);
    if (!html) {
      skipped++;
      continue;
    }
    const visits = parseVisits(html);
    insertSnap.run({
      $cid: row.id,
      $date: TODAY,
      $visits: visits,
      $raw: JSON.stringify({ domain, visits, captured_at: new Date().toISOString() }),
    });
    if (visits !== null) enriched++;
    await new Promise((r) => setTimeout(r, 1200)); // 礼貌限速
  }

  console.log(`[similarweb] tried=${rows.length}  enriched_with_visits=${enriched}  skipped=${skipped}`);
  console.log(`            tip: 抓不到的产品可在 Claude Code 里用 Firecrawl MCP 单独跑 /score`);
  return enriched;
}

if (import.meta.main) {
  await enrichSimilarWeb();
}
