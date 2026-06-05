/**
 * 生成飞书推送消息文本(中文,推给运营者本人)。
 * 只 print 到 stdout;实际发送由 daily-scan.sh 用 lark-cli 完成(便于调试/容错)。
 *
 * 用法: bun run scripts/notify-feishu.ts [--date YYYY-MM-DD]
 * 环境: SITE_URL(国内可访问站点根,默认上海云 8082)
 */
import { db, init } from "./db.ts";
init();

const args = process.argv.slice(2);
const di = args.indexOf("--date");
const date = di >= 0 && args[di + 1] ? args[di + 1] : new Date().toISOString().slice(0, 10);
const SITE_URL = (process.env.SITE_URL || "http://111.229.77.103:8082").replace(/\/+$/, "");

type R = { name: string; total: number; tier: string; window_estimate: string | null; url: string };

const top = db.query(`
  SELECT c.name, s.total, s.tier, s.window_estimate, c.url
  FROM scored s JOIN candidates c ON c.id = s.candidate_id
  WHERE s.tier IN ('⭐⭐⭐','⭐⭐')
    AND s.scored_at >= datetime('now', '-30 days')
  ORDER BY s.total DESC LIMIT 5
`).all() as R[];

const triple = top.filter((r) => r.tier === "⭐⭐⭐").length;
const double = top.filter((r) => r.tier === "⭐⭐").length;
const fresh = (db.query(`SELECT COUNT(*) n FROM candidates WHERE date(first_seen)=date('${date}')`).get() as { n: number }).n;

const lines: string[] = [];
lines.push(`📡 机会简报 ${date}`);
lines.push(`⭐⭐⭐ ${triple} · ⭐⭐ ${double} · 今日新信号 ${fresh}`);
lines.push("");
if (top.length > 0) {
  lines.push("值得长期推进:");
  top.forEach((r, i) => {
    const win = r.window_estimate ? ` · 窗口 ${r.window_estimate}` : "";
    lines.push(`${i + 1}. ${r.name} ${r.total}/35 ${r.tier}${win}`);
  });
} else {
  lines.push("本期暂无 ⭐⭐+ 候选 —— 诚实结果,继续手头项目。");
}
lines.push("");
lines.push(`🔗 国内查看:${SITE_URL}/latest.html`);
lines.push("（机器初评,⭐⭐⭐ 需人工 review;勿因有 ⭐⭐⭐ 就立刻 pivot）");

process.stdout.write(lines.join("\n"));
