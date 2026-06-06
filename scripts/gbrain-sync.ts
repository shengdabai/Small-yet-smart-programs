/**
 * gbrain 集成 — 把 ⭐⭐⭐ 候选 + pivot 备忘写进本地脑
 *
 * 依赖: gbrain CLI 已安装(`which gbrain`)
 * 不强依赖,gbrain 不存在则 skip,不阻塞 pipeline。
 *
 * 用法:
 *   bun run scripts/gbrain-sync.ts
 */
import { db, init } from "./db.ts";
import { execSync } from "node:child_process";

init();

function hasGbrain(): boolean {
  try {
    execSync("which gbrain", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

const rows = db
  .query(
    `SELECT c.id, c.name, c.url, c.description, c.source, c.first_seen,
            s.total, s.tier, s.window_estimate, s.replication_difficulty, s.why_them
     FROM scored s JOIN candidates c ON c.id = s.candidate_id
     WHERE s.tier = '⭐⭐⭐'
       AND s.scored_at >= datetime('now', '-30 days')`,
  )
  .all() as Array<{
    id: number;
    name: string;
    url: string;
    description: string;
    source: string;
    first_seen: string;
    total: number;
    tier: string;
    window_estimate: string;
    replication_difficulty: string;
    why_them: string;
  }>;

if (!hasGbrain()) {
  console.log(`[gbrain-sync] gbrain CLI 不在 PATH,skip(${rows.length} 个 ⭐⭐⭐ 候选未同步)`);
  process.exit(0);
}

if (rows.length === 0) {
  console.log("[gbrain-sync] 最近 30 天无 ⭐⭐⭐ 候选,nothing to sync");
  process.exit(0);
}

let synced = 0;
for (const r of rows) {
  const title = `SmartProgramsMining_${slug(r.name)}`;
  const content = `# ${r.name}

**评分**: ${r.total}/35 (${r.tier}) | **窗口**: ${r.window_estimate} | **复刻**: ${r.replication_difficulty}
**信号源**: ${r.source} | **首次发现**: ${r.first_seen}
**URL**: ${r.url}

## 描述
${r.description}

## why_them
\`\`\`json
${r.why_them}
\`\`\`

---
来源: smart-programs v5 SOP
`;

  try {
    execSync(`gbrain put --title "${title}" --tag "smart-programs-mining" --tag "${r.tier}"`, {
      input: content,
      stdio: ["pipe", "ignore", "ignore"],
    });
    synced++;
  } catch (e) {
    console.warn(`[gbrain-sync] failed for ${r.name}:`, (e as Error).message);
  }
}

console.log(`[gbrain-sync] synced ${synced}/${rows.length} 个 ⭐⭐⭐ 候选到 gbrain`);
