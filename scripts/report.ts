/**
 * Markdown 周报 / 月报生成器
 *
 * 用法:
 *   bun run scripts/report.ts --mode weekly
 *   bun run scripts/report.ts --mode monthly
 *
 * 输出: reports/<YYYY>-W<NN>-weekly.md / <YYYY>-<MM>-monthly.md
 */
import { db, init } from "./db.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

init();

const REPORTS_DIR = decodeURIComponent(new URL("../reports/", import.meta.url).pathname);
if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

function isoWeek(d: Date): string {
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return `${d.getUTCFullYear()}-W${week.toString().padStart(2, "0")}`;
}

type Cand = {
  id: number;
  source: string;
  name: string;
  url: string;
  description: string;
  signal_score: number | null;
  first_seen: string;
  total: number | null;
  tier: string | null;
  replication_difficulty: string | null;
  window_estimate: string | null;
};

function fetchCandidates(days: number): Cand[] {
  return db
    .query(
      `SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score, c.first_seen,
              s.total, s.tier, s.replication_difficulty, s.window_estimate
       FROM candidates c
       LEFT JOIN scored s ON s.candidate_id = c.id
       WHERE c.first_seen >= datetime('now', '-${days} days')
       ORDER BY COALESCE(s.total, 0) DESC, c.signal_score DESC NULLS LAST
       LIMIT 200`,
    )
    .all() as Cand[];
}

function bySource(rows: Cand[]) {
  const map = new Map<string, Cand[]>();
  for (const r of rows) {
    const key = r.source.split("/")[0];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

function fmtCandidate(c: Cand): string {
  const score = c.total ? ` **${c.tier ?? ""} ${c.total}/35**` : "";
  const diff = c.replication_difficulty ? ` _[${c.replication_difficulty}]_` : "";
  const win = c.window_estimate ? ` ⏱${c.window_estimate}` : "";
  const desc = (c.description || "").replace(/\n/g, " ").slice(0, 160);
  return `- **${c.name}**${score}${diff}${win}\n  - 源: \`${c.source}\` · signal=${c.signal_score ?? "-"}\n  - <${c.url}>\n  - ${desc}${desc.length >= 160 ? "..." : ""}`;
}

function writeWeekly() {
  const rows = fetchCandidates(7);
  const week = isoWeek(new Date());
  const filename = `${week}-weekly.md`;
  const path = `${REPORTS_DIR}${filename}`;

  const grouped = bySource(rows);
  const triple = rows.filter((r) => r.tier === "⭐⭐⭐");
  const double = rows.filter((r) => r.tier === "⭐⭐");

  let md = `# 扫描周报 ${week}\n\n`;
  md += `> 生成时间: ${new Date().toISOString()}\n`;
  md += `> 范围: 最近 7 天入库 ${rows.length} 个候选\n\n`;

  md += `## TL;DR\n\n`;
  md += `- ⭐⭐⭐ 候选: ${triple.length}\n`;
  md += `- ⭐⭐ 候选: ${double.length}\n`;
  md += `- 未评分: ${rows.filter((r) => !r.tier).length}\n`;
  md += `- 信号源覆盖: ${[...grouped.keys()].join(", ")}\n\n`;

  if (triple.length > 0) {
    md += `## ⭐⭐⭐ 本周成果\n\n`;
    for (const c of triple) md += fmtCandidate(c) + "\n\n";
  }
  if (double.length > 0) {
    md += `## ⭐⭐ 备选(3 月后回访)\n\n`;
    for (const c of double.slice(0, 10)) md += fmtCandidate(c) + "\n\n";
  }

  md += `## 按源分组(Top 5 each)\n\n`;
  for (const [src, list] of [...grouped.entries()].sort()) {
    md += `### ${src} (${list.length})\n\n`;
    for (const c of list.slice(0, 5)) md += fmtCandidate(c) + "\n\n";
  }

  md += `## 反陷阱自查\n\n`;
  md += `- 陷阱 1(逃避执行): 本周扫了几次? ≥ 2 次=过度,改月扫\n`;
  md += `- 陷阱 6(把简报当神): 这是机器生成的雏形,⭐⭐⭐ 需你人工 review\n\n`;

  md += `---\n_由 smart-programs 扫描器自动生成,源于 v5 SOP_\n`;

  writeFileSync(path, md, "utf8");
  console.log(`[report] weekly written: ${path}`);
  console.log(`         candidates=${rows.length} ⭐⭐⭐=${triple.length} ⭐⭐=${double.length}`);
  return path;
}

function writeMonthly() {
  const rows = fetchCandidates(30);
  const ym = new Date().toISOString().slice(0, 7);
  const filename = `${ym}-monthly.md`;
  const path = `${REPORTS_DIR}${filename}`;

  const triple = rows.filter((r) => r.tier === "⭐⭐⭐");

  let md = `# 扫描月报 ${ym}\n\n`;
  md += `> 生成时间: ${new Date().toISOString()}\n`;
  md += `> 范围: 最近 30 天入库 ${rows.length} 个候选\n\n`;

  md += `## 月度产出\n\n`;
  md += `- ⭐⭐⭐ 候选: ${triple.length}(每个应有独立 pivot-memo.md)\n`;
  md += `- 总候选: ${rows.length}\n\n`;

  if (triple.length > 0) {
    md += `## ⭐⭐⭐ 候选列表\n\n`;
    for (const c of triple) {
      md += fmtCandidate(c) + "\n\n";
      md += `  - **pivot memo**: \`reports/${ym}-${c.name.toLowerCase().replace(/\W+/g, "-")}-pivot.md\` (若已生成)\n\n`;
    }
  }

  md += `## 决策矩阵(v5 §10 D7)\n\n`;
  md += `| 候选 | 评分 | 当前手头项目 | 差距 | 建议 |\n`;
  md += `|------|------|------------|------|------|\n`;
  for (const c of triple) {
    md += `| ${c.name} | ${c.total} | (你填) | (你算) | (>+5 严肃 pivot / >+2 观察 / ≤ 继续手头) |\n`;
  }

  md += `\n## 反陷阱月度检查\n\n`;
  md += `- 陷阱 1: 月扫 1 次即可,这个月扫了几次?\n`;
  md += `- 陷阱 3(窗口期已关): ⭐⭐⭐ 候选的 window_estimate 是否还有 6+ 月?\n`;
  md += `- 陷阱 4: 每个 ⭐⭐⭐ 的 why_them.gap_severity 是否 ≤ mid?\n\n`;

  md += `---\n_由 smart-programs 扫描器自动生成,源于 v5 SOP §07/§09/§10_\n`;

  writeFileSync(path, md, "utf8");
  console.log(`[report] monthly written: ${path}`);
  return path;
}

const args = process.argv.slice(2);
const mode = args[args.indexOf("--mode") + 1];

if (mode === "monthly") writeMonthly();
else writeWeekly();
