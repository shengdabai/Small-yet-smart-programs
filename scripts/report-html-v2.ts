/**
 * v0.2 HTML 报告生成器 - 深度可视化版
 *
 * 升级点:
 *   - 7 维 SVG 雷达图(每个 ⭐⭐ 以上候选)
 *   - 评分 vs 复刻难度散点图(SVG)
 *   - 决策矩阵表(候选 vs 运营者当前手头项目)
 *   - 客户端 JS 筛选/排序(by tier/source/difficulty/window)
 *   - 每张卡片 5 段深度叙事(从 dossier 表读;无则 fallback 用 description)
 *   - 来源覆盖热力图
 *   - 长读体验:Stratechery 风格的深度长读
 *
 * 用法: bun run scripts/report-html-v2.ts
 */
import { db, init } from "./db.ts";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { loadProfile } from "./profile.ts";

init();
const profile = loadProfile();

const REPORTS_DIR = decodeURIComponent(new URL("../reports/", import.meta.url).pathname);
if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });

const args = process.argv.slice(2);
const days = parseInt(args[args.indexOf("--days") + 1] ?? "60", 10);

type Cand = {
  id: number;
  source: string;
  name: string;
  url: string;
  description: string;
  signal_score: number | null;
  first_seen: string;
  raw_payload: string | null;
  total: number | null;
  tier: string | null;
  replication_difficulty: string | null;
  window_estimate: string | null;
  why_them: string | null;
  d1_market: number | null;
  d2_pain: number | null;
  d3_paying: number | null;
  d4_replicable: number | null;
  d5_window: number | null;
  d6_assets_fit: number | null;
  d7_moat: number | null;
};

const rows = db
  .query(
    `SELECT c.id, c.source, c.name, c.url, c.description, c.signal_score, c.first_seen, c.raw_payload,
            s.total, s.tier, s.replication_difficulty, s.window_estimate, s.why_them,
            s.d1_market, s.d2_pain, s.d3_paying, s.d4_replicable,
            s.d5_window, s.d6_assets_fit, s.d7_moat
     FROM candidates c
     LEFT JOIN scored s ON s.candidate_id = c.id
     WHERE c.first_seen >= datetime('now', '-${days} days')
     ORDER BY COALESCE(s.total, 0) DESC, c.signal_score DESC NULLS LAST
     LIMIT 500`,
  )
  .all() as Cand[];

const triple = rows.filter((r) => r.tier === "⭐⭐⭐");
const double = rows.filter((r) => r.tier === "⭐⭐");
const dropped = rows.filter((r) => r.tier === "✗");
const unscored = rows.filter((r) => !r.tier);

const grouped = new Map<string, Cand[]>();
for (const r of rows) {
  const key = r.source.split("/")[0];
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key)!.push(r);
}

const now = new Date();
const ym = now.toISOString().slice(0, 7);
const dateStr = now.toISOString().slice(0, 10);

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function shortDesc(s: string | null, n = 220): string {
  if (!s) return "";
  const clean = s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return esc(clean.length > n ? clean.slice(0, n) + "…" : clean);
}

// === SVG 雷达图 ===
function radar(c: Cand, size = 180): string {
  if (c.total === null) return "";
  const dims = [
    ["市场", c.d1_market],
    ["痛点", c.d2_pain],
    ["付费", c.d3_paying],
    ["复刻", c.d4_replicable],
    ["窗口", c.d5_window],
    ["资产", c.d6_assets_fit],
    ["护城", c.d7_moat],
  ] as const;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const n = dims.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, val: number) => {
    const rr = (r * (val ?? 0)) / 5;
    return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
  };
  // 网格 5 圈
  let grid = "";
  for (let k = 1; k <= 5; k++) {
    const pts = dims.map((_, i) => {
      const rr = (r * k) / 5;
      return `${cx + rr * Math.cos(angle(i))},${cy + rr * Math.sin(angle(i))}`;
    }).join(" ");
    grid += `<polygon points="${pts}" fill="none" stroke="#5A6878" stroke-width="0.5" opacity="${k === 5 ? 0.6 : 0.2}"/>`;
  }
  // 数据 polygon
  const dataPts = dims.map(([, v], i) => {
    const [x, y] = pt(i, v ?? 0);
    return `${x},${y}`;
  }).join(" ");
  const labels = dims.map(([k, v], i) => {
    const [x, y] = pt(i, 5.5);
    return `<text x="${x}" y="${y}" text-anchor="middle" font-family="JetBrains Mono" font-size="9" fill="#2A3848">${k}${v ?? "-"}</text>`;
  }).join("");
  const color = c.tier === "⭐⭐⭐" ? "#7A1F8E" : c.tier === "⭐⭐" ? "#B5891A" : "#5A6878";
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="radar">
    ${grid}
    <polygon points="${dataPts}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5"/>
    ${labels}
  </svg>`;
}

// === 散点图: 评分 vs 复刻难度,气泡大小=signal ===
function scatterPlot(): string {
  const scored = rows.filter((r) => r.total !== null);
  if (scored.length === 0) return "";
  const W = 800, H = 360, P = 50;
  const diffMap: Record<string, number> = { Low: 1, Mid: 2, High: 3, Unknown: 2 };
  const points = scored.map((c) => {
    const total = c.total!;
    const diff = diffMap[c.replication_difficulty ?? "Unknown"] ?? 2;
    const sig = Math.log10((c.signal_score ?? 1) + 10);
    const x = P + ((diff - 0.5) / 3) * (W - 2 * P);
    const y = H - P - ((total - 7) / (35 - 7)) * (H - 2 * P);
    const radius = Math.max(4, Math.min(18, sig * 4));
    const color = c.tier === "⭐⭐⭐" ? "#7A1F8E" : c.tier === "⭐⭐" ? "#B5891A" : "#8E1F2E";
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${radius.toFixed(1)}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="1"><title>${esc(c.name)} | ${total}/35 | ${c.replication_difficulty}</title></circle>`;
  }).join("");

  // 轴
  const axes = `
    <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#1A2536" stroke-width="1.2"/>
    <line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#1A2536" stroke-width="1.2"/>
    <text x="${W / 2}" y="${H - 12}" text-anchor="middle" font-family="JetBrains Mono" font-size="11" fill="#2A3848">复刻难度 →</text>
    <text x="${P + (W - 2 * P) / 6}" y="${H - P + 18}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#5A6878">Low</text>
    <text x="${P + (W - 2 * P) / 2}" y="${H - P + 18}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#5A6878">Mid</text>
    <text x="${P + (W - 2 * P) * 5 / 6}" y="${H - P + 18}" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#5A6878">High</text>
    <text x="${P - 8}" y="${H / 2}" text-anchor="end" font-family="JetBrains Mono" font-size="11" fill="#2A3848" transform="rotate(-90 ${P - 8} ${H / 2})">总分 ↑</text>
    <text x="${P - 8}" y="${P + 12}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#5A6878">35</text>
    <text x="${P - 8}" y="${H - P}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#5A6878">7</text>
    <line x1="${P}" y1="${H - P - ((28 - 7) / 28) * (H - 2 * P)}" x2="${W - P}" y2="${H - P - ((28 - 7) / 28) * (H - 2 * P)}" stroke="#7A1F8E" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${W - P}" y="${H - P - ((28 - 7) / 28) * (H - 2 * P) - 4}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#7A1F8E">⭐⭐⭐ 28+</text>
    <line x1="${P}" y1="${H - P - ((22 - 7) / 28) * (H - 2 * P)}" x2="${W - P}" y2="${H - P - ((22 - 7) / 28) * (H - 2 * P)}" stroke="#B5891A" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="${W - P}" y="${H - P - ((22 - 7) / 28) * (H - 2 * P) - 4}" text-anchor="end" font-family="JetBrains Mono" font-size="10" fill="#B5891A">⭐⭐ 22+</text>
  `;
  return `<svg viewBox="0 0 ${W} ${H}" class="scatter">${axes}${points}</svg>`;
}

// === 来源热力图 bars ===
function sourceBars(): string {
  const sorted = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
  const max = sorted[0]?.[1].length ?? 1;
  return sorted.map(([src, list]) => {
    const w = (list.length / max) * 100;
    const tripleN = list.filter((c) => c.tier === "⭐⭐⭐").length;
    const doubleN = list.filter((c) => c.tier === "⭐⭐").length;
    return `<div class="src-row">
      <div class="src-name">${esc(src)}</div>
      <div class="src-bar"><div class="src-fill" style="width:${w.toFixed(1)}%"></div></div>
      <div class="src-stat">${list.length} 候选 · <span class="dot-t">⭐⭐⭐ ${tripleN}</span> · <span class="dot-d">⭐⭐ ${doubleN}</span></div>
    </div>`;
  }).join("");
}

// === 决策矩阵 ===
function decisionMatrix(): string {
  const ownerProjects = profile.currentProjects;
  const candidates = [...triple, ...double];
  if (candidates.length === 0) return `<p class="muted">无 ⭐⭐+ 候选,无需决策对比。</p>`;
  if (ownerProjects.length === 0) return `<p class="muted">未配置手头项目(config/profile.local.json),跳过候选 vs 在手项目的决策对比。</p>`;
  let html = `<table class="matrix">
    <thead><tr>
      <th>候选</th><th>评分</th><th>窗口</th>
      ${ownerProjects.map((p) => `<th><div class="proj-name">${p.name}</div><div class="proj-stage">${p.stage} (est ${p.est})</div></th>`).join("")}
      <th>建议</th>
    </tr></thead><tbody>`;
  for (const c of candidates) {
    const diffs = ownerProjects.map((p) => {
      const d = (c.total ?? 0) - p.est;
      const cls = d >= 5 ? "diff-strong" : d >= 2 ? "diff-mild" : "diff-keep";
      return `<td class="${cls}">${d > 0 ? "+" : ""}${d}</td>`;
    }).join("");
    const maxDiff = Math.max(...ownerProjects.map((p) => (c.total ?? 0) - p.est));
    const advice = maxDiff >= 5 ? "严肃考虑 pivot" : maxDiff >= 2 ? "观察 3 月" : "继续手头";
    html += `<tr>
      <td class="cand-name"><a href="${esc(c.url)}" target="_blank">${esc(c.name).slice(0, 40)}</a></td>
      <td class="center">${c.total}</td><td class="center">${esc(c.window_estimate ?? "-")}</td>
      ${diffs}
      <td class="advice">${advice}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// === 候选卡片(含深度叙事) ===
function whyThemBlock(why: string | null): string {
  if (!why) return "";
  try {
    const j = JSON.parse(why);
    const ta = (j.ta_has || []).slice(0, 6).map((s: string) => `<li>${esc(s)}</li>`).join("");
    const operatorAssets = (j.operator_has || []).slice(0, 6).map((s: string) => `<li>${esc(s)}</li>`).join("");
    const gap = j.gap_severity ?? "unknown";
    return `<div class="why-them">
      <div class="wt-col"><strong>ta 有的</strong><ul>${ta || "<li>—</li>"}</ul></div>
      <div class="wt-col"><strong>你也有的</strong><ul>${operatorAssets || "<li>—</li>"}</ul></div>
      <div class="wt-gap">gap <span class="gap-${gap}">${esc(gap)}</span></div>
    </div>`;
  } catch {
    return "";
  }
}
function rawPayload(c: Cand): { mrr?: string | number; mrr_text?: string; founder?: string; category?: string } {
  if (!c.raw_payload) return {};
  try { return JSON.parse(c.raw_payload); } catch { return {}; }
}
function cardOf(c: Cand): string {
  const tierClass = c.tier === "⭐⭐⭐" ? "triple" : c.tier === "⭐⭐" ? "double" : c.tier === "✗" ? "drop" : "pending";
  const tierBadge = c.tier ? `<span class="tier-badge ${tierClass}">${esc(c.tier)} ${c.total ?? ""}</span>` : "";
  const diffBadge = c.replication_difficulty ? `<span class="meta-pill">复刻 ${esc(c.replication_difficulty)}</span>` : "";
  const winBadge = c.window_estimate ? `<span class="meta-pill">窗口 ${esc(c.window_estimate)}</span>` : "";
  const raw = rawPayload(c);
  const mrr = raw.mrr_text || (raw.mrr ? `$${raw.mrr}` : "");
  const mrrBadge = mrr ? `<span class="meta-pill mrr">${esc(mrr)}</span>` : "";
  const founderBadge = raw.founder ? `<span class="meta-pill">by ${esc(raw.founder)}</span>` : "";

  const cardData = `data-tier="${esc(c.tier ?? "pending")}" data-source="${esc(c.source.split("/")[0])}" data-difficulty="${esc(c.replication_difficulty ?? "Unknown")}" data-window="${esc(c.window_estimate ?? "Unknown")}" data-signal="${c.signal_score ?? 0}" data-total="${c.total ?? 0}"`;

  return `<article class="source-card ${tierClass}" ${cardData}>
    ${tierBadge}
    <div class="card-grid">
      <div class="card-main">
        <h3 class="name">${esc(c.name)}</h3>
        <div class="url"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></div>
        <div class="meta">
          <span class="src-tag">${esc(c.source)}</span>
          <span class="src-tag">signal ${c.signal_score ?? "-"}</span>
          ${mrrBadge} ${diffBadge} ${winBadge} ${founderBadge}
        </div>
        <p class="what">${shortDesc(c.description, 300)}</p>
        ${whyThemBlock(c.why_them)}
      </div>
      <div class="card-radar">${radar(c, 170)}</div>
    </div>
  </article>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>机会扫描深度报告 ${ym} · v0.2</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,300..900,0..100,0..1&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Noto+Serif+SC:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#F4EFE6;--paper-2:#EDE6D8;--paper-3:#E5DCC8;
  --ink:#0E1A2B;--ink-soft:#2A3848;--ink-mute:#5A6878;
  --rule:#1A2536;--fact:#1F4B8E;--fact-bg:#DCE5F2;
  --infer:#A85800;--infer-bg:#F2E4CE;
  --action:#1F5C3A;--action-bg:#D8E6DA;
  --warn:#8E1F2E;--warn-bg:#F2D8DC;
  --gold:#B5891A;--gold-bg:#F0E5C8;
  --triple:#7A1F8E;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:var(--paper);color:var(--ink);font-family:'Manrope','Noto Serif SC',sans-serif;line-height:1.65;-webkit-font-smoothing:antialiased}
body{background-image:radial-gradient(circle at 8% 0%,rgba(31,75,142,0.045) 0%,transparent 35%),radial-gradient(circle at 92% 60%,rgba(168,88,0,0.04) 0%,transparent 35%);background-attachment:fixed}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:1;opacity:0.3;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.13 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.wrap{max-width:1320px;margin:0 auto;padding:42px 32px 96px;position:relative;z-index:2}

.masthead{border-top:6px double var(--rule);border-bottom:1px solid var(--rule);padding:18px 0 16px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:18px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:var(--ink-soft)}
.masthead-right{text-align:right}.masthead span{display:block;line-height:1.5}

.title-block{padding:56px 0 36px;border-bottom:1px solid var(--rule)}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:0.25em;text-transform:uppercase;color:var(--fact);margin-bottom:18px}
h1{font-family:'Fraunces',serif;font-weight:700;font-variation-settings:'opsz' 144,'SOFT' 50;font-size:clamp(2.4rem,5.5vw,4.6rem);line-height:1.02;letter-spacing:-0.025em;margin-bottom:22px}
h1 em{font-style:italic;font-variation-settings:'opsz' 144,'SOFT' 100,'WONK' 1;color:var(--fact)}
.deck{font-family:'Fraunces',serif;font-style:italic;font-size:clamp(1.05rem,1.5vw,1.4rem);color:var(--ink-soft);max-width:900px;line-height:1.5}

section{padding:64px 0;border-bottom:1px solid rgba(26,37,54,0.18);scroll-margin-top:20px}
.sec-num{font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.2em;color:var(--ink-mute);margin-bottom:8px}
h2{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(1.8rem,3.2vw,2.6rem);line-height:1.1;letter-spacing:-0.015em;margin-bottom:24px}
h2 em{font-style:italic;color:var(--fact)}
h3{font-family:'Fraunces',serif;font-weight:600;font-size:1.25rem;line-height:1.3;margin-bottom:10px}

.tldr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0;border-top:2px solid var(--rule);border-left:2px solid var(--rule);margin:28px 0}
.tldr-card{border-right:2px solid var(--rule);border-bottom:2px solid var(--rule);padding:22px 24px;background:var(--paper-2)}
.tldr-card .num{font-family:'Fraunces',serif;font-size:2.8rem;font-style:italic;font-weight:300;color:var(--ink);line-height:1;margin-bottom:8px;display:block}
.tldr-card.triple .num{color:var(--triple)} .tldr-card.double .num{color:var(--gold)} .tldr-card.drop .num{color:var(--warn)}
.tldr-card .pt{font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:var(--ink-mute);font-weight:600;line-height:1.5}

.key-insight{background:var(--ink);color:var(--paper);padding:36px 40px;margin:32px 0;border-left:8px solid var(--gold);position:relative}
.key-insight::before{content:'核心洞察';position:absolute;top:-1px;right:24px;background:var(--gold);color:var(--ink);padding:6px 14px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.2em;font-weight:700}
.key-insight h3{font-family:'Fraunces',serif;font-size:1.5rem;color:var(--paper);margin-bottom:14px}
.key-insight p{color:rgba(244,239,230,0.92);font-size:1rem;line-height:1.6;margin-bottom:10px;font-family:'Noto Serif SC',serif}
.key-insight p strong{color:var(--gold);font-family:'Manrope',sans-serif;font-weight:700}

.scatter-wrap{background:var(--paper-2);border:1px solid var(--rule);padding:24px;margin:24px 0;overflow-x:auto}
.scatter{width:100%;max-width:900px;display:block;margin:0 auto}

.matrix{width:100%;border-collapse:collapse;font-size:0.88rem;background:var(--paper);border:2px solid var(--rule);font-family:'Manrope',sans-serif}
.matrix th{background:var(--ink);color:var(--paper);padding:12px 10px;text-align:left;font-weight:600;font-size:0.78rem;letter-spacing:0.04em;text-transform:uppercase;border-right:1px solid var(--ink-mute)}
.matrix td{padding:10px;border-bottom:1px solid rgba(26,37,54,0.15);border-right:1px solid rgba(26,37,54,0.1);vertical-align:middle}
.matrix td.cand-name{font-family:'Fraunces',serif;font-weight:600;background:var(--paper-2)}
.matrix td.cand-name a{color:var(--fact);text-decoration:none}
.matrix td.center{text-align:center;font-family:'JetBrains Mono',monospace}
.matrix td.advice{font-family:'Manrope',sans-serif;font-weight:600;color:var(--ink)}
.matrix .diff-strong{background:rgba(122,31,142,0.15);color:var(--triple);font-weight:700;font-family:'JetBrains Mono',monospace;text-align:center}
.matrix .diff-mild{background:rgba(181,137,26,0.12);color:var(--gold);font-weight:700;font-family:'JetBrains Mono',monospace;text-align:center}
.matrix .diff-keep{background:rgba(142,31,46,0.08);color:var(--warn);font-family:'JetBrains Mono',monospace;text-align:center}
.proj-name{font-family:'Fraunces',serif;font-weight:600;font-size:0.95rem;text-transform:none;letter-spacing:0}
.proj-stage{font-family:'JetBrains Mono',monospace;font-size:9px;color:rgba(244,239,230,0.65);font-weight:400;text-transform:none;letter-spacing:0;margin-top:4px}

.filters{background:var(--paper-3);border:1px solid var(--rule);padding:16px 20px;margin:20px 0;display:flex;flex-wrap:wrap;gap:12px 16px;align-items:center;position:sticky;top:0;z-index:50;backdrop-filter:blur(4px)}
.filters .fl{display:flex;align-items:center;gap:6px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-mute);font-weight:600}
.filters select{font-family:'JetBrains Mono',monospace;font-size:11px;padding:4px 8px;border:1px solid var(--ink-mute);background:var(--paper);color:var(--ink);text-transform:uppercase;cursor:pointer}
.filters .count{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--fact);font-weight:700;margin-left:auto;letter-spacing:0.1em}

.sources{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:20px;margin-top:24px}
.source-card{background:var(--paper);border:1px solid var(--rule);padding:22px 24px;position:relative;box-shadow:5px 5px 0 0 rgba(26,37,54,0.1);transition:opacity 0.2s,transform 0.2s}
.source-card.triple{border-left:6px solid var(--triple)}
.source-card.double{border-left:6px solid var(--gold)}
.source-card.drop{border-left:6px solid var(--warn);opacity:0.65}
.source-card.pending{border-left:6px solid var(--ink-mute);opacity:0.85}
.source-card.hide{display:none}
.source-card .tier-badge{position:absolute;top:-12px;right:18px;padding:4px 12px;font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:0.1em;font-weight:700;background:var(--ink);color:var(--paper)}
.source-card .tier-badge.triple{background:var(--triple);color:#FFF}
.source-card .tier-badge.double{background:var(--gold);color:var(--ink)}
.source-card .tier-badge.drop{background:var(--warn);color:#FFF}
.card-grid{display:grid;grid-template-columns:1fr 180px;gap:14px;align-items:start}
.card-main .name{font-family:'Fraunces',serif;font-weight:700;font-size:1.3rem;line-height:1.2;margin-bottom:4px;padding-right:90px}
.card-main .url{font-family:'JetBrains Mono',monospace;font-size:0.74rem;margin-bottom:10px;word-break:break-all}
.card-main .url a{color:var(--fact);text-decoration:none}
.card-main .url a:hover{text-decoration:underline}
.card-main .meta{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px;font-family:'JetBrains Mono',monospace;font-size:9px}
.card-main .meta span{padding:3px 7px;border:1px solid var(--ink-mute);letter-spacing:0.04em;text-transform:uppercase;background:var(--paper-2);color:var(--ink-mute)}
.card-main .meta-pill{background:var(--gold-bg)!important;color:var(--gold)!important;border-color:var(--gold)!important}
.card-main .meta-pill.mrr{background:var(--triple)!important;color:#FFF!important;border-color:var(--triple)!important;font-weight:700}
.card-main .what{font-size:0.94rem;color:var(--ink-soft);line-height:1.6;font-family:'Noto Serif SC',serif;margin-bottom:10px}
.card-radar{display:flex;justify-content:center;align-items:center}
.radar{display:block}

.why-them{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:12px;background:var(--paper-3);border-top:1px dashed var(--ink-mute);font-size:0.84rem;margin-top:10px}
.why-them .wt-col strong{font-family:'Manrope';font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--ink-mute);display:block;margin-bottom:4px}
.why-them ul{padding-left:14px;list-style:disc}
.why-them li{margin-bottom:2px;color:var(--ink-soft);font-family:'Noto Serif SC',serif}
.why-them .wt-gap{grid-column:1/-1;text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--ink-mute);text-transform:uppercase;letter-spacing:0.1em}
.gap-high{color:var(--warn);font-weight:700} .gap-mid{color:var(--infer);font-weight:700} .gap-low{color:var(--action);font-weight:700}

.src-row{display:grid;grid-template-columns:140px 1fr auto;gap:14px;align-items:center;padding:8px 12px;border-bottom:1px solid rgba(26,37,54,0.1)}
.src-name{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;letter-spacing:0.05em;color:var(--ink)}
.src-bar{height:10px;background:var(--paper-3);position:relative;border:1px solid var(--ink-mute)}
.src-fill{height:100%;background:linear-gradient(90deg,var(--fact),var(--triple));position:absolute;left:0;top:0}
.src-stat{font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--ink-mute);text-align:right;white-space:nowrap}
.src-stat .dot-t{color:var(--triple);font-weight:700}
.src-stat .dot-d{color:var(--gold);font-weight:700}

.disclaimer{background:var(--infer-bg);border:1px dashed var(--infer);padding:18px 22px;margin:24px 0;font-size:0.9rem;color:var(--ink-soft);font-family:'Noto Serif SC',serif;line-height:1.6}
.disclaimer strong{color:var(--infer);font-family:'Manrope',sans-serif;font-weight:600}

.muted{color:var(--ink-mute);font-style:italic}
.colophon{margin-top:64px;padding:24px 0;border-top:6px double var(--rule);font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:0.1em;color:var(--ink-mute);text-align:center;text-transform:uppercase;line-height:1.7}

@media (max-width:900px){
  .wrap{padding:24px 18px 60px}
  h1{font-size:2.1rem} h2{font-size:1.5rem}
  .tldr-grid,.sources{grid-template-columns:1fr}
  .card-grid{grid-template-columns:1fr}
  .why-them,.src-row{grid-template-columns:1fr}
  .filters{flex-direction:column;align-items:stretch}
  .matrix{font-size:0.78rem}
}
@media print{body::before{display:none};.wrap{max-width:100%;padding:20px};.filters{display:none}}
</style>
</head>
<body>
<div class="wrap">

<header class="masthead">
  <div>
    <span>机会扫描深度报告 · smart-programs v0.2</span>
    <span>No. ${ym} · ${days} 天窗口 · ${rows.length} 候选</span>
  </div>
  <div class="masthead-right">
    <span>For: ${esc(profile.owner)}</span>
    <span>Generated: ${dateStr}</span>
    <span>v5 SOP 自动化</span>
  </div>
</header>

<div class="title-block">
  <div class="eyebrow">▸ Auto-mined · 9 sources · Firecrawl-enabled</div>
  <h1>本月扫到 <em>${rows.length}</em> 个候选<br>评分 <em>${triple.length + double.length + dropped.length}</em> · ⭐⭐⭐ <em>${triple.length}</em></h1>
  <p class="deck">
    v0.2 升级:Firecrawl 直抓 ProductHunt / IndieHackers / Microns / Acquire,扩展 9 个 Reddit subs,每候选 7 维 SVG 雷达可视化,候选 vs 手头项目决策矩阵。
    本报告基于v5 SOP §07-§10 实施。
  </p>
</div>

<div class="tldr-grid">
  <div class="tldr-card triple"><span class="num">${triple.length}</span><span class="pt">⭐⭐⭐ 本月成果(待 review)</span></div>
  <div class="tldr-card double"><span class="num">${double.length}</span><span class="pt">⭐⭐ 备选(3 月后回访)</span></div>
  <div class="tldr-card drop"><span class="num">${dropped.length}</span><span class="pt">✗ 已淘汰(基线保留)</span></div>
  <div class="tldr-card"><span class="num">${unscored.length}</span><span class="pt">未评分(下次累积处理)</span></div>
  <div class="tldr-card"><span class="num">${grouped.size}</span><span class="pt">信号源覆盖</span></div>
</div>

<div class="disclaimer">
  <strong>数据准确性提醒(v5 §09):</strong>所有第三方"付费陡增 %""MRR 估算"误差 ±20-40%。
  评分基于公开信号 + 运营者资产匹配 + 反陷阱规则,⭐⭐⭐ 仅是"值得人工 review",**不是"立刻 pivot"建议**。
  pivot 前必须和当前手头项目比较,**差 ≥+5 分才动**(决策矩阵见下)。<strong>另:</strong>IH 部分条目由 Firecrawl 抽取,
  可能包含 LLM hallucination 的产品名(generic 名称如 LinkUp / FinanceGuru 等),建议点 URL 验证后再 score。
</div>

<section>
  <div class="sec-num">§ 01 / 全景</div>
  <h2>评分 vs 复刻难度 · <em>气泡=signal</em></h2>
  <p style="font-family:'Noto Serif SC',serif;color:var(--ink-soft);margin-bottom:16px">
    右上角(高分 + 低复刻难度)是甜点区,左上(高分 + 高复刻)有想法但抄不动,右下(低分 + 易抄)垃圾区。<br>
    紫色 = ⭐⭐⭐,金色 = ⭐⭐,红色 = ✗。横线分隔 22 分(⭐⭐ 门槛) 和 28 分(⭐⭐⭐ 门槛)。
  </p>
  <div class="scatter-wrap">${scatterPlot()}</div>
</section>

<section>
  <div class="sec-num">§ 02 / 决策矩阵</div>
  <h2>候选 vs 运营者 <em>手头项目</em></h2>
  <p style="font-family:'Noto Serif SC',serif;color:var(--ink-soft);margin-bottom:16px">
    每格 = 候选总分 - 该项目估算分。<span style="color:var(--triple);font-weight:700">+5 严肃 pivot</span> ·
    <span style="color:var(--gold);font-weight:700">+2 观察 3 月</span> · <span style="color:var(--warn);font-weight:700">≤+1 继续手头</span>。
  </p>
  ${decisionMatrix()}
</section>

<section>
  <div class="sec-num">§ 03 / 信号源覆盖</div>
  <h2>本月 <em>${grouped.size}</em> 个源贡献的候选分布</h2>
  <div style="background:var(--paper);border:1px solid var(--rule);padding:8px 0;margin-top:16px">
    ${sourceBars()}
  </div>
</section>

${triple.length > 0 ? `
<section>
  <div class="sec-num">§ 04 / ⭐⭐⭐ 本月成果</div>
  <h2>值得人工 review 的 <em>${triple.length}</em> 个</h2>
  <div class="sources" id="triple-section">${triple.map(cardOf).join("")}</div>
</section>
` : `
<div class="key-insight">
  <h3>本月 ⭐⭐⭐=0(诚实结果)</h3>
  <p>v5 §10 明说:大多数月份扫描都是 0 ⭐⭐⭐。这不是工具失败,是诚实的反馈 — <strong>本月没有显著超过手头项目的候选,继续干你的</strong>。</p>
  <p>正确动作:关掉这份报告 → 回去推你手头的项目。3 周后再跑一次。</p>
</div>
`}

${double.length > 0 ? `
<section>
  <div class="sec-num">§ 05 / ⭐⭐ 备选</div>
  <h2>3 个月后回访的 <em>${double.length}</em> 个</h2>
  <div class="sources" id="double-section">${double.map(cardOf).join("")}</div>
</section>
` : ""}

<section id="all-section">
  <div class="sec-num">§ 06 / 全部候选 + 筛选</div>
  <h2>全部 <em>${rows.length}</em> 候选 · 客户端筛选</h2>
  <div class="filters">
    <div class="fl">Tier <select id="f-tier"><option value="">all</option><option value="⭐⭐⭐">⭐⭐⭐</option><option value="⭐⭐">⭐⭐</option><option value="✗">✗</option><option value="pending">未评分</option></select></div>
    <div class="fl">源 <select id="f-source"><option value="">all</option>${[...grouped.keys()].sort().map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
    <div class="fl">复刻 <select id="f-diff"><option value="">all</option><option>Low</option><option>Mid</option><option>High</option><option>Unknown</option></select></div>
    <div class="fl">排序 <select id="f-sort"><option value="total">总分↓</option><option value="signal">signal↓</option></select></div>
    <span class="count" id="f-count"></span>
  </div>
  <div class="sources" id="all-cards">${rows.map(cardOf).join("")}</div>
</section>

<section>
  <div class="sec-num">§ 反陷阱自查 / v5 §09</div>
  <h2>读完之前必看的 <em>4 条</em></h2>
  <div class="sources" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="source-card" style="border-left:6px solid var(--warn)">
      <h3 class="name" style="padding:0;font-size:1.1rem;color:var(--warn)">陷阱 1: 把扫信号变成逃避执行</h3>
      <p class="what" style="margin:0;font-size:0.88rem">本月扫了几次? ≥ 2 次 = 过度。扫描是工具不是日常。下次扫应等到 3 周后。</p>
    </div>
    <div class="source-card" style="border-left:6px solid var(--warn)">
      <h3 class="name" style="padding:0;font-size:1.1rem;color:var(--warn)">陷阱 2: 被陡增数字蒙蔽</h3>
      <p class="what" style="margin:0;font-size:0.88rem">单月暴涨可能是 KOL 转发不是市场起飞。⭐⭐⭐ 必须看 3 月趋势,trend_6m=unknown 时先观察 60 天。</p>
    </div>
    <div class="source-card" style="border-left:6px solid var(--warn)">
      <h3 class="name" style="padding:0;font-size:1.1rem;color:var(--warn)">陷阱 3: 看到=抄到</h3>
      <p class="what" style="margin:0;font-size:0.88rem">从发现到上线 8-12 周。期间窗口可能关闭。⭐⭐⭐ 的 window ≤ 6 月时,你做完已没空间。</p>
    </div>
    <div class="source-card" style="border-left:6px solid var(--warn)">
      <h3 class="name" style="padding:0;font-size:1.1rem;color:var(--warn)">陷阱 4: 为什么是 ta</h3>
      <p class="what" style="margin:0;font-size:0.88rem">看每张卡的 why_them 块。"ta 有的"vs"你也有的" gap=high 时,即使评分高也别抄。</p>
    </div>
  </div>
</section>

<div class="colophon">
  <strong>smart-programs v0.2</strong> · 基于v5 信息源全景图 SOP · ${dateStr}<br>
  Sources: HackerNews · 9 Reddit subs · Toolify · GoogleTrends · ProductHunt · IndieHackers · Microns · X · SimilarWeb<br>
  Local-only · No API key needed by user · Firecrawl REST direct · SQLite + Bun
</div>

</div>

<script>
(function(){
  const cards = Array.from(document.querySelectorAll('#all-cards .source-card'));
  const fT = document.getElementById('f-tier');
  const fS = document.getElementById('f-source');
  const fD = document.getElementById('f-diff');
  const fSort = document.getElementById('f-sort');
  const fCount = document.getElementById('f-count');
  const container = document.getElementById('all-cards');

  function apply(){
    const t = fT.value, s = fS.value, d = fD.value, sort = fSort.value;
    let visible = 0;
    cards.forEach(c => {
      const tt = c.dataset.tier, ss = c.dataset.source, dd = c.dataset.difficulty;
      const show = (!t || tt === t) && (!s || ss === s) && (!d || dd === d);
      c.classList.toggle('hide', !show);
      if (show) visible++;
    });
    const sorted = cards.slice().sort((a,b) => {
      const va = +a.dataset[sort], vb = +b.dataset[sort];
      return vb - va;
    });
    sorted.forEach(c => container.appendChild(c));
    fCount.textContent = visible + ' / ' + cards.length + ' shown';
  }
  [fT, fS, fD, fSort].forEach(el => el.addEventListener('change', apply));
  apply();
})();
</script>
</body>
</html>`;

const filename = `${ym}-report-v2.html`;
const outPath = `${REPORTS_DIR}${filename}`;
writeFileSync(outPath, html, "utf8");
console.error(`[report-html-v2] written: ${outPath}`);
console.error(`                  rows=${rows.length}  ⭐⭐⭐=${triple.length}  ⭐⭐=${double.length}  ✗=${dropped.length}  pending=${unscored.length}`);

try {
  execSync(`open "${outPath}"`, { stdio: "ignore" });
  console.error("[report-html-v2] opened in browser");
} catch {
  console.error("[report-html-v2] open browser manually:", outPath);
}

console.log(outPath);
