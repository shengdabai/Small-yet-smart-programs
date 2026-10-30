/**
 * 总管 pipeline。
 *
 * Modes:
 *   daily   只跑增量源(HN + Reddit + Toolify + GoogleTrends),~30s
 *   monthly 跑全量 8 源 + similarweb enrich + builtwith,~3-5min
 *
 * 评分(7 维 OPC)由 Claude Code 在 slash command 里跑,
 * 因为不需要外部 API key,直接读 prompt + db 输出即可。
 *
 * 抓不到的源(PH / IH 反爬)会把 target_urls 写到 data/firecrawl-todo.json,
 * slash command 末尾用 Firecrawl MCP 兜底抓。
 */
import { existsSync, readFileSync } from "node:fs";
import { init, db } from "./db.ts";
import { fetchHackerNews } from "./sources/hackernews.ts";
import { fetchReddit } from "./sources/reddit.ts";
import { fetchProductHunt } from "./sources/producthunt.ts";
import { fetchIndieHackers } from "./sources/indiehackers.ts";
import { fetchToolify } from "./sources/toolify.ts";
import { fetchGoogleTrends } from "./sources/google-trends.ts";
import { fetchXBuilders } from "./sources/x-builders.ts";
import { enrichSimilarWeb } from "./sources/similarweb.ts";
import { enrichBuiltWith } from "./enrich/builtwith.ts";

type Mode = "daily" | "monthly" | "single";

async function runDaily() {
  console.log("=== DAILY SCAN ===  (HN + Reddit + Toolify + GoogleTrends)");
  const t0 = Date.now();
  init();

  const results = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchToolify(),
    fetchGoogleTrends(),
  ]);
  const total = results.reduce((sum, r) => (r.status === "fulfilled" ? sum + r.value : sum), 0);
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`[pipeline] source #${i} failed:`, r.reason);
  });

  console.log(`=== DAILY DONE === new=${total}  elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printStats();
}

async function runMonthly() {
  console.log("=== MONTHLY SCAN ===  (8 sources + enrich)");
  const t0 = Date.now();
  init();

  // Stage 1: 所有源并行抓
  const stage1 = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchProductHunt(),     // 反爬时写 firecrawl-todo
    fetchIndieHackers(),    // 反爬时写 firecrawl-todo
    fetchToolify(),
    fetchGoogleTrends(),
    fetchXBuilders(),
  ]);
  const newCands = stage1.reduce((s, r) => (r.status === "fulfilled" ? s + r.value : s), 0);
  console.log(`[pipeline] stage1 sources done, new candidates=${newCands}`);

  // Stage 2: 序贯 enrich(限速)
  console.log("[pipeline] stage2 enrich (similarweb)...");
  await enrichSimilarWeb({ limit: 30 }).catch((e) => console.error("[pipeline] similarweb err:", e));

  console.log("[pipeline] stage2 enrich (builtwith)...");
  await enrichBuiltWith({ limit: 30 }).catch((e) => console.error("[pipeline] builtwith err:", e));

  console.log(`=== MONTHLY DONE === elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  printStats();
  printFirecrawlTodo();
}

async function runSingle(source: string) {
  init();
  switch (source) {
    case "hackernews": return fetchHackerNews();
    case "reddit": return fetchReddit();
    case "producthunt": return fetchProductHunt();
    case "indiehackers": return fetchIndieHackers();
    case "toolify": return fetchToolify();
    case "google-trends": return fetchGoogleTrends();
    case "x-builders": return fetchXBuilders();
    case "similarweb": return enrichSimilarWeb();
    case "builtwith": return enrichBuiltWith();
    default: throw new Error(`unknown source: ${source}`);
  }
}

function printStats() {
  const { count } = db.query("SELECT COUNT(*) AS count FROM candidates").get() as { count: number };
  const { scored } = db.query("SELECT COUNT(*) AS scored FROM scored WHERE total IS NOT NULL").get() as { scored: number };
  const { triple } = db.query("SELECT COUNT(*) AS triple FROM scored WHERE tier = '⭐⭐⭐'").get() as { triple: number };
  console.log(`[stats] candidates=${count}  scored=${scored}  ⭐⭐⭐=${triple}`);
}

function printFirecrawlTodo() {
  const path = decodeURIComponent(new URL("../data/firecrawl-todo.json", import.meta.url).pathname);
  if (!existsSync(path)) return;
  const todo = JSON.parse(readFileSync(path, "utf8"));
  const keys = Object.keys(todo);
  if (keys.length > 0) {
    console.log(`[firecrawl-todo] 待 Firecrawl MCP 兜底: ${keys.join(", ")}`);
    console.log(`                文件: ${path}`);
  }
}

const args = process.argv.slice(2);
const modeIdx = args.indexOf("--mode");
const sourceIdx = args.indexOf("--source");
const mode = (modeIdx >= 0 ? args[modeIdx + 1] : "daily") as Mode;

if (sourceIdx >= 0) {
  await runSingle(args[sourceIdx + 1]);
  printStats();
} else if (mode === "monthly") {
  await runMonthly();
} else {
  await runDaily();
}
