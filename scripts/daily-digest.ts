/**
 * 每日双语机会简报生成器(数据级双语:zh 显示中文名+中文点评,en 显示英文原文)。
 *
 * 从机会库取:
 *   1. 近 N 天评分出的 ⭐⭐⭐ / ⭐⭐ 候选 —— "值得长期推进的项目"
 *   2. 当日新增的高 signal 候选 —— "最新产品信息"
 * 产出:
 *   daily/<YYYY-MM-DD>.html   中英双语单页(zh/en 切换),部署到国内站
 *   daily/<YYYY-MM-DD>.md     中文 markdown 留档
 *
 * 中文字段(name_zh / description_zh / summary_zh)由评分步骤的 LLM 产出;
 * 缺失时优雅回退到英文原文。
 *
 * 用法: bun run scripts/daily-digest.ts [--date YYYY-MM-DD] [--days 30]
 */
import { db, init } from "./db.ts";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

init();

const args = process.argv.slice(2);
function arg(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const today = arg("--date", new Date().toISOString().slice(0, 10));
const lookbackDays = parseInt(arg("--days", "30"), 10);

const ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const DAILY_DIR = ROOT + "daily/";
if (!existsSync(DAILY_DIR)) mkdirSync(DAILY_DIR, { recursive: true });

type Row = {
  name: string; name_zh: string | null; url: string;
  description: string | null; description_zh: string | null; summary_zh: string | null;
  source: string; signal_score: number | null;
  total: number | null; tier: string | null;
  window_estimate: string | null; replication_difficulty: string | null; why_them: string | null;
  first_seen: string; scored_at: string | null;
};

const longTerm = db.query(`
  SELECT c.name, c.name_zh, c.url, c.description, c.description_zh, s.summary_zh,
         c.source, c.signal_score,
         s.total, s.tier, s.window_estimate, s.replication_difficulty, s.why_them,
         c.first_seen, s.scored_at
  FROM scored s JOIN candidates c ON c.id = s.candidate_id
  WHERE s.tier IN ('⭐⭐⭐','⭐⭐')
    AND s.scored_at >= datetime('now', '-${lookbackDays} days')
  ORDER BY s.total DESC, c.signal_score DESC NULLS LAST
  LIMIT 20
`).all() as Row[];

const fresh = db.query(`
  SELECT c.name, c.name_zh, c.url, c.description, c.description_zh, NULL as summary_zh,
         c.source, c.signal_score,
         NULL as total, NULL as tier, NULL as window_estimate,
         NULL as replication_difficulty, NULL as why_them,
         c.first_seen, NULL as scored_at
  FROM candidates c
  WHERE date(c.first_seen) = date('${today}')
  ORDER BY c.signal_score DESC NULLS LAST
  LIMIT 15
`).all() as Row[];

const triple = longTerm.filter((r) => r.tier === "⭐⭐⭐");
const double = longTerm.filter((r) => r.tier === "⭐⭐");

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function short(s: string | null, n = 200): string {
  if (!s) return "";
  const c = s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return esc(c.length > n ? c.slice(0, n) + "…" : c);
}
const zhName = (r: Row) => r.name_zh || r.name;
const zhDesc = (r: Row) => r.summary_zh || r.description_zh || r.description;

// ---------- Markdown(中文留档)----------
function mdSection(title: string, rows: Row[]): string {
  if (rows.length === 0) return `### ${title}\n\n_无_\n\n`;
  let s = `### ${title}\n\n`;
  for (const r of rows) {
    const score = r.total ? ` · ${r.total}/35 ${r.tier ?? ""}` : r.signal_score ? ` · 热度 ${Math.round(r.signal_score)}` : "";
    const win = r.window_estimate ? ` · 窗口 ${r.window_estimate}` : "";
    s += `- **${zhName(r)}**${score}${win}\n  ${short(zhDesc(r), 120)}\n  ${r.url}\n`;
  }
  return s + "\n";
}
const md =
`# 机会简报 — ${today}

> 自动生成于 smart-programs · 7 维评分法 (v5 SOP)

## 值得长期推进
- ⭐⭐⭐ ${triple.length} · ⭐⭐ ${double.length}

${mdSection("⭐⭐⭐ 高分候选", triple)}${mdSection("⭐⭐ 备选", double)}## 最新产品信号(${today})

${mdSection("今日新增", fresh)}---
_机器初筛 + LLM 初评,⭐⭐⭐ 需人工 review;不要因为有 ⭐⭐⭐ 就立刻 pivot(见 METHODOLOGY.md 反陷阱 5)。_
`;
writeFileSync(DAILY_DIR + `${today}.md`, md, "utf8");

// ---------- 双语 HTML(数据级双语)----------
function card(r: Row): string {
  const badge = r.tier
    ? `<span class="badge ${r.tier === "⭐⭐⭐" ? "t3" : "t2"}">${esc(r.tier)} ${r.total ?? ""}</span>`
    : r.signal_score != null ? `<span class="badge sig"><span class="zh">热度 ${Math.round(r.signal_score)}</span><span class="en">signal ${Math.round(r.signal_score)}</span></span>` : "";
  const win = r.window_estimate ? `<span class="pill">${esc(r.window_estimate)}</span>` : "";
  const diff = r.replication_difficulty ? `<span class="pill">复刻 ${esc(r.replication_difficulty)}</span>` : "";
  return `<article class="card">
    <div class="card-head">
      <a class="name" href="${esc(r.url)}" target="_blank" rel="noopener"><span class="zh">${esc(zhName(r))}</span><span class="en">${esc(r.name)}</span></a>${badge}
    </div>
    <div class="src">${esc(r.source)}</div>
    <p class="desc"><span class="zh">${short(zhDesc(r))}</span><span class="en">${short(r.description)}</span></p>
    <div class="pills">${win}${diff}</div>
    <a class="src-link" href="${esc(r.url)}" target="_blank" rel="noopener">🔗 <span class="zh">查看原项目</span><span class="en">View source</span> ↗</a>
  </article>`;
}
function htmlSection(rows: Row[], emptyZh: string, emptyEn: string): string {
  if (rows.length === 0) return `<p class="muted"><span class="zh">${emptyZh}</span><span class="en">${emptyEn}</span></p>`;
  return `<div class="grid">${rows.map(card).join("")}</div>`;
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>机会简报 ${today} · Opportunity Briefing</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--ink:#e8eaed;--mut:#9aa3b2;--gold:#d4a72c;--p3:#b06cd4;--acc:#4a9eff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC","Segoe UI",system-ui,sans-serif;line-height:1.6}
.wrap{max-width:1100px;margin:0 auto;padding:32px 20px 80px}
header{border-bottom:1px solid var(--line);padding-bottom:20px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px}
h1{font-size:1.7rem;letter-spacing:-.01em}
.date{color:var(--mut);font-family:ui-monospace,monospace;font-size:.85rem}
.toggle{display:flex;gap:6px}
.toggle button{background:var(--card);color:var(--mut);border:1px solid var(--line);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.85rem}
.toggle button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.summary{display:flex;gap:18px;margin-bottom:28px;flex-wrap:wrap}
.stat{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 20px;min-width:120px}
.stat .n{font-size:2rem;font-weight:700}
.stat.t3 .n{color:var(--p3)} .stat.t2 .n{color:var(--gold)}
.stat .l{color:var(--mut);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}
h2{font-size:1.15rem;margin:32px 0 14px;padding-left:10px;border-left:3px solid var(--acc)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px}
.card-head{display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:4px}
.name{color:var(--ink);font-weight:600;text-decoration:none;font-size:1.02rem}
.name:hover{color:var(--acc)}
.badge{font-size:.72rem;font-family:ui-monospace,monospace;padding:2px 8px;border-radius:20px;white-space:nowrap;background:#222}
.badge.t3{background:rgba(176,108,212,.2);color:var(--p3)} .badge.t2{background:rgba(212,167,44,.2);color:var(--gold)} .badge.sig{color:var(--mut)}
.src{color:var(--mut);font-size:.72rem;font-family:ui-monospace,monospace;margin-bottom:8px}
.desc{color:#c4cad6;font-size:.9rem;margin-bottom:10px}
.pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.src-link{display:inline-block;font-size:.82rem;color:var(--acc);text-decoration:none;border:1px solid var(--acc);border-radius:6px;padding:5px 12px;transition:.15s}
.src-link:hover{background:var(--acc);color:#fff}
.pill{font-size:.7rem;color:var(--mut);border:1px solid var(--line);padding:2px 8px;border-radius:20px}
.muted{color:var(--mut);font-style:italic;padding:8px 0}
.disclaimer{margin-top:40px;padding:16px 20px;background:rgba(212,167,44,.08);border:1px solid rgba(212,167,44,.3);border-radius:10px;color:var(--mut);font-size:.86rem}
footer{margin-top:40px;color:var(--mut);font-size:.78rem;text-align:center;font-family:ui-monospace,monospace}
.en{display:none}
body.lang-en .zh{display:none} body.lang-en .en{display:inline}
</style>
</head>
<body class="lang-zh">
<div class="wrap">
<header>
  <div>
    <h1><span class="zh">机会简报</span><span class="en">Opportunity Briefing</span></h1>
    <div class="date">${today} · smart-programs</div>
  </div>
  <div class="toggle">
    <button id="b-zh" class="on" onclick="setLang('zh')">中文</button>
    <button id="b-en" onclick="setLang('en')">EN</button>
  </div>
</header>

<div class="summary">
  <div class="stat t3"><div class="n">${triple.length}</div><div class="l">⭐⭐⭐</div></div>
  <div class="stat t2"><div class="n">${double.length}</div><div class="l">⭐⭐</div></div>
  <div class="stat"><div class="n">${fresh.length}</div><div class="l"><span class="zh">今日新信号</span><span class="en">fresh today</span></div></div>
</div>

<h2><span class="zh">值得长期推进</span><span class="en">Worth pursuing — top picks</span></h2>
${htmlSection(triple, "本期暂无 ⭐⭐⭐(诚实结果,继续手头项目)", "No ⭐⭐⭐ this round (an honest result — keep building).")}

<h2><span class="zh">备选(3 个月后回访)</span><span class="en">Shortlist (revisit in 3 months)</span></h2>
${htmlSection(double, "暂无 ⭐⭐ 备选", "No ⭐⭐ shortlist yet.")}

<h2><span class="zh">最新产品信号</span><span class="en">Fresh signals today</span></h2>
${htmlSection(fresh, "今日无新增候选", "No new candidates today.")}

<div class="disclaimer">
  <span class="zh">机器初筛 + LLM 初评。⭐⭐⭐ 仅代表"值得人工 review",不是"立刻 pivot"。pivot 前必须和手头项目比较,差 +5 分才动(见 METHODOLOGY.md 反陷阱 5)。</span>
  <span class="en">Machine pre-filter + LLM first-pass scoring. ⭐⭐⭐ means "worth a human review", not "pivot now". Only switch if it beats your current project by +5 points (see METHODOLOGY.md, anti-trap 5).</span>
</div>

<footer>smart-programs · 7-dimension rubric (v5 SOP) · ${today}</footer>
</div>
<script>
function setLang(l){
  document.body.className = 'lang-' + l;
  document.getElementById('b-zh').classList.toggle('on', l==='zh');
  document.getElementById('b-en').classList.toggle('on', l==='en');
  try{ localStorage.setItem('sp-lang', l); }catch(e){}
}
try{ const s = localStorage.getItem('sp-lang'); if(s) setLang(s); }catch(e){}
</script>
</body>
</html>`;
writeFileSync(DAILY_DIR + `${today}.html`, html, "utf8");

console.log(`[daily-digest] ${today}: ⭐⭐⭐=${triple.length} ⭐⭐=${double.length} fresh=${fresh.length}`);
console.log(`[daily-digest] wrote daily/${today}.html + .md`);
