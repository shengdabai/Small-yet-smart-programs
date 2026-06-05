/**
 * 把 daily/*.html 组装成可部署静态站 site/。
 *   - copy 每日简报到 site/
 *   - 生成 site/index.html:时间线索引(倒序),最新一篇置顶
 *   - site/latest.html → 最新一篇副本
 *
 * site/ 是部署产物(gitignored),rsync 到上海云 serve;daily/ 是入库留档源。
 *
 * 用法: bun run scripts/build-site.ts
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";

const ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const DAILY = ROOT + "daily/";
const SITE = ROOT + "site/";
if (!existsSync(SITE)) mkdirSync(SITE, { recursive: true });
if (!existsSync(DAILY)) { console.error("[build-site] no daily/ yet, nothing to build"); process.exit(0); }

const dates = readdirSync(DAILY)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
  .map((f) => f.replace(".html", ""))
  .sort()
  .reverse();

if (dates.length === 0) { console.error("[build-site] no daily html files"); process.exit(0); }

for (const d of dates) copyFileSync(DAILY + `${d}.html`, SITE + `${d}.html`);
copyFileSync(DAILY + `${dates[0]}.html`, SITE + "latest.html");

const items = dates.map((d) => `      <li><a href="${d}.html">${d}</a> <span class="zh">机会简报</span><span class="en">briefing</span></li>`).join("\n");

const index = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Small Yet Smart Programs · 机会简报存档</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--ink:#e8eaed;--mut:#9aa3b2;--acc:#4a9eff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:-apple-system,"PingFang SC","Segoe UI",system-ui,sans-serif;line-height:1.7}
.wrap{max-width:760px;margin:0 auto;padding:48px 20px 80px}
h1{font-size:1.8rem;margin-bottom:6px}
.sub{color:var(--mut);margin-bottom:8px}
.toggle{display:flex;gap:6px;margin:16px 0 28px}
.toggle button{background:var(--card);color:var(--mut);border:1px solid var(--line);padding:6px 14px;border-radius:6px;cursor:pointer}
.toggle button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.latest{display:block;background:var(--card);border:1px solid var(--acc);border-radius:12px;padding:20px 24px;margin-bottom:28px;text-decoration:none;color:var(--ink)}
.latest .lbl{color:var(--acc);font-size:.78rem;text-transform:uppercase;letter-spacing:.05em}
.latest .dt{font-size:1.3rem;font-weight:700;margin-top:4px}
ul{list-style:none}
li{padding:12px 0;border-bottom:1px solid var(--line)}
li a{color:var(--ink);text-decoration:none;font-family:ui-monospace,monospace;font-size:1.05rem;margin-right:10px}
li a:hover{color:var(--acc)}
li span{color:var(--mut);font-size:.85rem}
.en{display:none}
body.lang-en .zh{display:none} body.lang-en .en{display:inline}
footer{margin-top:48px;color:var(--mut);font-size:.78rem;font-family:ui-monospace,monospace}
</style>
</head>
<body class="lang-zh">
<div class="wrap">
  <h1>Small Yet Smart Programs</h1>
  <div class="sub"><span class="zh">每日机会简报存档 · 7 维评分法</span><span class="en">Daily opportunity briefings · 7-dimension rubric</span></div>
  <div class="toggle">
    <button id="b-zh" class="on" onclick="setLang('zh')">中文</button>
    <button id="b-en" onclick="setLang('en')">EN</button>
  </div>
  <a class="latest" href="latest.html">
    <div class="lbl"><span class="zh">最新</span><span class="en">Latest</span></div>
    <div class="dt">${dates[0]}</div>
  </a>
  <ul>
${items}
  </ul>
  <footer>smart-programs · ${dates.length} briefings</footer>
</div>
<script>
function setLang(l){
  document.body.className='lang-'+l;
  document.getElementById('b-zh').classList.toggle('on',l==='zh');
  document.getElementById('b-en').classList.toggle('on',l==='en');
  try{localStorage.setItem('sp-lang',l)}catch(e){}
}
try{const s=localStorage.getItem('sp-lang');if(s)setLang(s)}catch(e){}
</script>
</body>
</html>`;
writeFileSync(SITE + "index.html", index, "utf8");
console.log(`[build-site] ${dates.length} briefings → site/ (latest ${dates[0]})`);
