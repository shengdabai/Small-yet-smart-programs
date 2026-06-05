/**
 * Google Trends 关键词陡增检测
 *
 * 对应 v5 §03 Google Trends:
 *   - 候选关键词 12 个月趋势
 *   - 验证一个产品类别是否真的在涨
 *
 * 实现:用 Google 公开的 trending searches RSS + Trends widget JSON。
 * 不要求精确数字,只标记"涨/平/降"。
 *
 * keywords 列表存 data/trending-keywords.txt,用户自己维护。
 * 默认种子是 v5 提到的 AI/SaaS/独立开发常见赛道。
 */
import { upsertCandidate } from "../db.ts";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const SEEDS_PATH = decodeURIComponent(
  new URL("../../data/trending-keywords.txt", import.meta.url).pathname,
);

const DEFAULT_SEEDS = [
  "ai notetaker",
  "ai content detector",
  "faceless videos",
  "no code app builder",
  "ai voice clone",
  "chinese learning app",
  "saas boilerplate",
  "ai resume",
  "ai meeting summary",
  "indie hacker tools",
];

function loadSeeds(): string[] {
  if (!existsSync(SEEDS_PATH)) {
    writeFileSync(SEEDS_PATH, DEFAULT_SEEDS.join("\n") + "\n", "utf8");
    console.log(`[google-trends] seeded ${SEEDS_PATH}`);
  }
  return readFileSync(SEEDS_PATH, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

export async function fetchGoogleTrends(): Promise<number> {
  const seeds = loadSeeds();
  const today = new Date().toISOString().slice(0, 10);

  // Google Trends "Realtime trending searches" daily JSON(全球 US):
  // 这里用每日 trending 公开端点作为信号
  let realtime: string[] = [];
  try {
    const r = await fetch(
      "https://trends.google.com/trends/api/dailytrends?hl=en-US&tz=240&geo=US&ns=15",
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (r.ok) {
      // Google 返回带前缀 ")]}',\n" 的 JSON
      const text = (await r.text()).replace(/^[^{]+/, "");
      try {
        const j = JSON.parse(text);
        realtime = j?.default?.trendingSearchesDays?.[0]?.trendingSearches?.map(
          (t: any) => t?.title?.query,
        ) ?? [];
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.warn("[google-trends] daily trends fetch failed:", (e as Error).message);
  }

  let newCount = 0;

  // 1. 把当天 US trending 整体写入(标 source=google-trends/daily)
  for (const q of realtime.slice(0, 25)) {
    if (!q) continue;
    const { is_new } = upsertCandidate({
      source: "google-trends/daily",
      external_id: `${today}:${q}`,
      name: q,
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      title: q,
      description: `Google Trends daily trending (US) ${today}`,
      signal_score: 5,
      raw_payload: { date: today, geo: "US" },
    });
    if (is_new) newCount++;
  }

  // 2. 用户 seeds 每个写一条占位记录,后续 enrich 时用 widget 抓 12 月趋势
  for (const seed of seeds) {
    const { is_new } = upsertCandidate({
      source: "google-trends/seed",
      external_id: seed,
      name: seed,
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(seed)}`,
      title: `[seed] ${seed}`,
      description: "User-curated trend seed (12 month watch)",
      signal_score: 1,
      raw_payload: { keyword: seed },
    });
    if (is_new) newCount++;
  }

  console.log(`[google-trends] daily=${realtime.length}  seeds=${seeds.length}  new=${newCount}`);
  return newCount;
}

if (import.meta.main) {
  await fetchGoogleTrends();
}
