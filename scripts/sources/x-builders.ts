/**
 * X(Twitter)build-in-public KOL 监听
 *
 * 对应 v5 §03 X 信号源:
 *   - 关注 50 个独立开发者(Pieter Levels / Marc Lou / Arvid Kahl 等)
 *   - X 公开 API 已废,只能用 nitter 镜像(经常挂)或 RSS Hub
 *
 * 实现:维护 data/kol-list.txt,每行一个 handle。
 * 通过 nitter 镜像列表轮询 + Firecrawl 兜底。
 *
 * 这个源**经常抓不到**(nitter 不稳定 + X 反爬升级),所以是 best-effort,
 * 不到的话不阻塞 pipeline,后续可手动在 Claude Code 里用 WebFetch 单点查。
 */
import { upsertCandidate } from "../db.ts";
import { readFileSync, existsSync, writeFileSync } from "node:fs";

const KOL_PATH = decodeURIComponent(new URL("../../data/kol-list.txt", import.meta.url).pathname);

const SEED_KOLS = [
  "levelsio",       // Pieter Levels (Nomad List)
  "marc_louvion",   // Marc Lou (ShipFast)
  "arvidkahl",      // Arvid Kahl
  "dvassallo",      // Daniel Vassallo
  "mijustin",       // Justin Jackson (Transistor)
  "tdinh_me",       // Tony Dinh (TypingMind)
  "_anniruddha",    // small SaaS builder
  "danielvf",       // 独立开发
  "jakobgreenfeld", // Founder Boost
  "yongfook",       // Bannerbear founder
];

const NITTER_HOSTS = [
  "nitter.poast.org",
  "nitter.privacydev.net",
  "nitter.net",
];

function loadKols(): string[] {
  if (!existsSync(KOL_PATH)) {
    writeFileSync(KOL_PATH, SEED_KOLS.join("\n") + "\n", "utf8");
    console.log(`[x-builders] seeded ${KOL_PATH} with ${SEED_KOLS.length} handles`);
  }
  return readFileSync(KOL_PATH, "utf8")
    .split("\n")
    .map((s) => s.trim().replace(/^@/, ""))
    .filter((s) => s && !s.startsWith("#"));
}

async function fetchNitterRss(handle: string): Promise<string | null> {
  for (const host of NITTER_HOSTS) {
    try {
      const r = await fetch(`https://${host}/${handle}/rss`, {
        headers: { "User-Agent": "smart-programs/0.1" },
      });
      if (r.ok) {
        const text = await r.text();
        if (text.includes("<item>")) return text;
      }
    } catch {
      /* try next host */
    }
  }
  return null;
}

const SIGNAL_PATTERNS = [
  /\$\s*[\d,]+(?:\.\d+)?\s*(?:k|K|\/mo|MRR|monthly)/,
  /\b(?:hit|reached|crossed|just\s+made)\s+\$/i,
  /\b(?:launch(?:ed|ing)?|went live)\b/i,
];

export async function fetchXBuilders(): Promise<number> {
  const kols = loadKols();
  let newCount = 0;
  let kolsReached = 0;

  for (const handle of kols.slice(0, 15)) {
    // 不全跑,nitter 太慢且会被 ban,每次轮 15 个
    const rss = await fetchNitterRss(handle);
    if (!rss) continue;
    kolsReached++;

    const re = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    let kolNew = 0;
    while ((m = re.exec(rss))) {
      const block = m[1];
      const pick = (tag: string) => {
        const r = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
        return r ? r[1].replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").trim() : "";
      };
      const title = pick("title");
      const link = pick("link");
      const desc = pick("description");
      if (!title) continue;
      // 只留有"建造/收入/上线"信号的推
      const matched = SIGNAL_PATTERNS.some((p) => p.test(title) || p.test(desc));
      if (!matched) continue;

      const guid = pick("guid") || link;
      const { is_new } = upsertCandidate({
        source: `x/${handle}`,
        external_id: guid,
        name: title.slice(0, 80),
        url: link,
        title,
        description: desc.replace(/<[^>]+>/g, "").slice(0, 600),
        signal_score: 3,
        raw_payload: { handle, guid },
      });
      if (is_new) {
        newCount++;
        kolNew++;
      }
    }
    if (kolNew > 0) console.log(`[x-builders] @${handle} new=${kolNew}`);
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`[x-builders] kols=${kols.length}  reached=${kolsReached}  new_signals=${newCount}`);
  if (kolsReached === 0) {
    console.warn("[x-builders] all nitter hosts unreachable — 这是常态。可手动在 Claude 里用 WebFetch 单查关心的 KOL");
  }
  return newCount;
}

if (import.meta.main) {
  await fetchXBuilders();
}
