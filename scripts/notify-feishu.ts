/**
 * 飞书推送消息生成 / 发送。
 *
 * 两种模式:
 *   默认            : 打印纯文本到 stdout(由 daily-scan.sh 交给 hermes send;链接不可点)
 *   --webhook       : 若设了 FEISHU_WEBHOOK 环境变量,直接 POST 飞书自定义机器人 webhook,
 *                     发 post 富文本(链接是真正可点的 <a> 超链接)
 *
 * 用法:
 *   bun run scripts/notify-feishu.ts                 # 打印 text
 *   FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx \
 *     bun run scripts/notify-feishu.ts --webhook     # 发可点链接
 * 环境: SITE_URL(国内可访问站点根,默认上海云 8082)
 */
import { db, init } from "./db.ts";
init();

const args = process.argv.slice(2);
const di = args.indexOf("--date");
const date = di >= 0 && args[di + 1] ? args[di + 1] : new Date().toISOString().slice(0, 10);
const useWebhook = args.includes("--webhook");
const SITE_URL = (process.env.SITE_URL || "http://YOUR_SERVER:8082").replace(/\/+$/, "");
const LINK = `${SITE_URL}/latest.html`;
const DEGRADED_REASON = (process.env.DEGRADED_REASON || "").trim();

type R = { name: string; name_zh: string | null; total: number; tier: string; window_estimate: string | null };

const top = db.query(`
  SELECT c.name, c.name_zh, s.total, s.tier, s.window_estimate
  FROM scored s JOIN candidates c ON c.id = s.candidate_id
  WHERE s.tier IN ('⭐⭐⭐','⭐⭐')
    AND s.scored_at >= datetime('now', '-30 days')
  ORDER BY s.total DESC LIMIT 5
`).all() as R[];

const triple = top.filter((r) => r.tier === "⭐⭐⭐").length;
const double = top.filter((r) => r.tier === "⭐⭐").length;
const fresh = (db.query(`SELECT COUNT(*) n FROM candidates WHERE date(first_seen)=date('${date}')`).get() as { n: number }).n;

const pickLines = top.length
  ? top.map((r, i) => `${i + 1}. ${r.name_zh || r.name} ${r.total}/35 ${r.tier}${r.window_estimate ? ` · 窗口 ${r.window_estimate}` : ""}`)
  : ["本期暂无 ⭐⭐+ 候选 —— 诚实结果,继续手头项目。"];

// ---------- webhook(post 富文本,链接可点)----------
async function sendWebhook(url: string) {
  const contentRows: any[][] = [
    [{ tag: "text", text: `⭐⭐⭐ ${triple} · ⭐⭐ ${double} · 今日新信号 ${fresh}` }],
    [{ tag: "text", text: "" }],
    [{ tag: "text", text: "值得长期推进:" }],
    ...pickLines.map((l) => [{ tag: "text", text: l }]),
    ...(DEGRADED_REASON ? [[{ tag: "text", text: `⚠️ 降级说明：${DEGRADED_REASON}` }]] : []),
    [{ tag: "text", text: "" }],
    [{ tag: "a", text: "🔗 点此查看完整简报(国内秒开)", href: LINK }],
    [{ tag: "text", text: "" }],
    [{ tag: "text", text: "(机器初评,⭐⭐⭐ 需人工 review;勿因有 ⭐⭐⭐ 就立刻 pivot)" }],
  ];
  const payload = {
    msg_type: "post",
    content: { post: { zh_cn: { title: `📡 机会简报 ${date}`, content: contentRows } } },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`[feishu-webhook] HTTP ${res.status} ${body}`);
  if (!res.ok || /"code":[1-9]/.test(body)) process.exit(1);
}

// ---------- 纯文本(hermes fallback)----------
function printText() {
  const focus = top.length ? (top[0].name_zh || top[0].name) : "";
  const summary = top.length
    ? `今日扫描 ${fresh} 个新信号,评分后${triple > 0 ? ` ${triple} 个 ⭐⭐⭐ 强候选` : "无 ⭐⭐⭐"}${double > 0 ? `、${double} 个 ⭐⭐ 备选` : ""}。重点关注:${focus}。`
    : `今日扫描 ${fresh} 个新信号,暂无 ⭐⭐+ 候选 —— 诚实结果,继续手头项目。`;
  const lines = [
    `📡 **机会简报 ${date}**`,
    `⭐⭐⭐ ${triple} · ⭐⭐ ${double} · 今日新信号 ${fresh}`,
    "",
    `📌 ${summary}`,
    "",
    "**值得长期推进:**",
    ...pickLines,
    ...(DEGRADED_REASON ? ["", `⚠️ 降级说明：${DEGRADED_REASON}`] : []),
    "",
    `🔗 [点此打开完整简报（国内秒开,可逐项点进原项目）](${LINK})`,
    "",
    "_机器初评,⭐⭐⭐ 需人工 review;勿因有 ⭐⭐⭐ 就立刻 pivot_",
  ];
  process.stdout.write(lines.join("\n"));
}

if (useWebhook && process.env.FEISHU_WEBHOOK) {
  await sendWebhook(process.env.FEISHU_WEBHOOK);
} else {
  printText();
}
