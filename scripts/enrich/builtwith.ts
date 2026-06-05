/**
 * BuiltWith 技术栈推断(对应 v5 §07-4)
 *
 * 目标:对每个候选判定复刻难度 Low / Mid / High
 *   - Low:no-code(Bubble / Webflow / Carrd / Framer)+ Stripe
 *   - Mid:Next.js / Vercel / Supabase / Cloudflare Workers
 *   - High:自建 backend + K8s + ML pipeline
 *
 * 不用 BuiltWith API(要钱),直接拉目标网站 HTML,正则匹配技术指纹。
 * 准确率没 BuiltWith Pro 高,但足够分 Low/Mid/High 三档。
 */
import { db } from "../db.ts";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const NOCODE_SIGNS = [
  /bubble\.io/i,
  /webflow\.com/i,
  /carrd\.co/i,
  /framer\.com\/script/i,
  /tilda\.cc/i,
  /notion-static/i,
  /squarespace\.com/i,
  /wix\.com/i,
];

const MID_SIGNS = [
  /_next\/static/i,
  /__NEXT_DATA__/i,
  /nuxt/i,
  /vercel/i,
  /netlify/i,
  /supabase/i,
  /firebase/i,
  /cloudflare-workers/i,
  /\.svelte/i,
  /sveltekit/i,
  /astro/i,
];

const HIGH_SIGNS = [
  /kubernetes/i,
  /tensorflow/i,
  /pytorch/i,
  /graphql/i,
  /grpc/i,
  /\.proto/i,
];

const PAY_SIGNS = [
  /stripe\.com/i,
  /js\.stripe\.com/i,
  /paddle\.com/i,
  /lemonsqueezy/i,
  /gumroad/i,
];

type StackVerdict = {
  tech: string[];
  payments: string[];
  difficulty: "Low" | "Mid" | "High" | "Unknown";
};

export function classifyStack(html: string, headers: Record<string, string> = {}): StackVerdict {
  const tech: string[] = [];
  const payments: string[] = [];
  const blob = html + "\n" + Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join("\n");

  for (const re of NOCODE_SIGNS) if (re.test(blob)) tech.push(`nocode:${re.source}`);
  for (const re of MID_SIGNS) if (re.test(blob)) tech.push(`mid:${re.source}`);
  for (const re of HIGH_SIGNS) if (re.test(blob)) tech.push(`high:${re.source}`);
  for (const re of PAY_SIGNS) if (re.test(blob)) payments.push(re.source);

  const hasNocode = tech.some((t) => t.startsWith("nocode:"));
  const hasHigh = tech.some((t) => t.startsWith("high:"));
  const hasMid = tech.some((t) => t.startsWith("mid:"));

  let difficulty: StackVerdict["difficulty"] = "Unknown";
  if (hasNocode && !hasHigh) difficulty = "Low";
  else if (hasMid && !hasHigh) difficulty = "Mid";
  else if (hasHigh) difficulty = "High";
  else if (tech.length > 0) difficulty = "Mid";

  return { tech, payments, difficulty };
}

async function fetchHtml(url: string): Promise<{ html: string; headers: Record<string, string> } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow" });
    if (!res.ok) return null;
    const html = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { html, headers };
  } catch {
    return null;
  }
}

export async function enrichBuiltWith(opts: { limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 20;
  const rows = db
    .query(
      `SELECT c.id, c.url FROM candidates c
       LEFT JOIN scored s ON s.candidate_id = c.id
       WHERE c.url IS NOT NULL
         AND (s.builtwith_tech IS NULL OR s.builtwith_tech = '')
       ORDER BY c.signal_score DESC NULLS LAST
       LIMIT ?`,
    )
    .all(limit) as { id: number; url: string }[];

  let updated = 0;
  for (const row of rows) {
    if (!row.url.startsWith("http")) continue;
    const fetched = await fetchHtml(row.url);
    if (!fetched) continue;
    const verdict = classifyStack(fetched.html, fetched.headers);

    db.query(
      `INSERT INTO scored (candidate_id, builtwith_tech, replication_difficulty)
       VALUES ($cid, $tech, $diff)
       ON CONFLICT(candidate_id) DO UPDATE SET
         builtwith_tech = excluded.builtwith_tech,
         replication_difficulty = excluded.replication_difficulty`,
    ).run({
      $cid: row.id,
      $tech: JSON.stringify({ tech: verdict.tech, payments: verdict.payments }),
      $diff: verdict.difficulty,
    });
    updated++;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`[builtwith] tried=${rows.length}  updated=${updated}`);
  return updated;
}

if (import.meta.main) {
  await enrichBuiltWith();
}
