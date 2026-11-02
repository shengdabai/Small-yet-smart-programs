/**
 * 重建 README 首页的「每日简报」索引区块。
 *
 * 扫 daily/*.md,逐篇提取 日期 + ⭐⭐⭐/⭐⭐ 统计 + ⭐⭐ 亮点项目名,
 * 倒序(最新在上)注入 README 的标记区块(幂等):
 *   <!-- BRIEFINGS:START --> ... <!-- BRIEFINGS:END -->
 * 区块不存在时,首次自动插到 README 首个 `---` 分隔线之后。
 *
 * 链接用 repo 相对路径 daily/<date>.md(GitHub 渲染可点);不放任何服务器 IP(脱敏)。
 *
 * 用法: bun run scripts/gen-readme-index.ts
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DAILY = join(ROOT, "daily");
const README = join(ROOT, "README.md");
const START = "<!-- BRIEFINGS:START -->";
const END = "<!-- BRIEFINGS:END -->";

interface Entry {
  date: string;
  triple: number;
  double: number;
  picks: string[];
}

function parse(date: string, md: string): Entry {
  let triple = 0;
  let double = 0;
  const stat = md.match(/⭐⭐⭐\s*(\d+)\s*·\s*⭐⭐\s*(\d+)/);
  if (stat) {
    triple = Number(stat[1]);
    double = Number(stat[2]);
  }
  // 抓 ⭐⭐ 备选行的项目名(形如 `- **Name** · 22/35`),最多 3 个做亮点
  const picks: string[] = [];
  const re = /^- \*\*(.+?)\*\*\s*·\s*\d+\/35/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null && picks.length < 3) {
    picks.push(m[1].trim());
  }
  return { date, triple, double, picks };
}

function row(e: Entry): string {
  const stars = `⭐⭐⭐ ${e.triple} · ⭐⭐ ${e.double}`;
  const hi = e.picks.length ? ` — ${e.picks.join("、")}` : "";
  return `- **[${e.date}](daily/${e.date}.md)** · ${stars}${hi}`;
}

const files = existsSync(DAILY)
  ? readdirSync(DAILY)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
  : [];

const entries = files.map((f) => {
  const date = f.replace(/\.md$/, "");
  return parse(date, readFileSync(join(DAILY, f), "utf8"));
});

const list = entries.length
  ? entries.map(row).join("\n")
  : "_暂无简报,等首次扫描生成 / No briefings yet._";

const block = `${START}

### 📅 每日简报 · Daily Briefings

${list}

> 每天中午 12:30 自动更新 · Auto-updated daily at 12:30 · [全部简报 →](daily/)

${END}`;

let readme = readFileSync(README, "utf8");

if (readme.includes(START) && readme.includes(END)) {
  readme = readme.replace(
    new RegExp(`${START}[\\s\\S]*?${END}`),
    () => block,
  );
} else {
  // 首次注入:插到首个 `---` 分隔线之后,否则置顶
  const sep = readme.indexOf("\n---\n");
  if (sep >= 0) {
    const at = sep + "\n---\n".length;
    readme = `${readme.slice(0, at)}\n${block}\n${readme.slice(at)}`;
  } else {
    readme = `${block}\n\n${readme}`;
  }
}

writeFileSync(README, readme, "utf8");
console.log(`[gen-readme-index] ${entries.length} briefings indexed -> README.md`);
