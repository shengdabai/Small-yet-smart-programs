import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The Feishu "降级说明" must describe what really failed in this run's scan output, not a fixed guess.
// Everything here is local: bun/git/codex/hermes are stubs, scan output is a fixture log, the proxy is a
// loopback server. No real scan, Feishu, Codex, Reddit or Toolify request is made.

const script = join(import.meta.dir, "..", "daily-scan.sh");
const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true });
});

// Line formats are the ones scripts/sources/{reddit,hackernews,toolify}.ts and pipeline.ts print.
const REDDIT_PATHS = [
  ["/r/SideProject", "week"], ["/r/SaaS", "week"], ["/r/microsaas", "week"], ["/r/Entrepreneur", "week"],
  ["/r/EntrepreneurRideAlong", "week"], ["/r/sidehustle", "week"], ["/r/indiehackers", "week"],
  ["/r/digitalnomad", "month"], ["/r/SaaSSales", "week"],
];
const redditSkip = (path: string, t: string, status: string) =>
  `[reddit] ${path} skip: Reddit https://www.reddit.com${path}/top.json?t=${t}&limit=100 ${status}`;
const redditOk = (path: string) => `[reddit] ${path} fetched=100 new=2`;

const HEAD = ["$ bun run scripts/pipeline.ts --mode daily", "=== DAILY SCAN ===  (HN + Reddit + Toolify + GoogleTrends)"];
const TAIL = ["[hackernews] fetched=100  new=1  threshold=50pts/30d", "[google-trends] daily=0  seeds=10  new=0", "=== DAILY DONE === new=1  elapsed=22.7s"];

const allRedditBlocked = [...HEAD, ...REDDIT_PATHS.map(([p, t]) => redditSkip(p, t, "403")), "[toolify] unreachable — 后续可走 Firecrawl MCP", ...TAIL].join("\n") + "\n";
const allHealthy = [...HEAD, ...REDDIT_PATHS.map(([p]) => redditOk(p)), "[toolify] fetched=30  new=3", ...TAIL].join("\n") + "\n";

function summarize(log: string) {
  const result = Bun.spawnSync({
    cmd: ["/bin/bash", "-c", 'source "$1"; summarize_source_failures', "--", script],
    env: { ...process.env, SMART_PROGRAMS_LIBRARY_ONLY: "1", LOGDIR: mkdtempSync(join(tmpdir(), "smart-programs-sum-")) },
    stdin: Buffer.from(log),
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

describe("summarize_source_failures", () => {
  test("lists a fully blocked Reddit and an unreachable Toolify as they happened", () => {
    const r = summarize(allRedditBlocked);
    expect(r.code).toBe(0);
    expect(r.out).toBe("Reddit 9/9 个板块 403；Toolify 不可达");
  });

  test("says nothing when every source answered", () => {
    const r = summarize(allHealthy);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("counts only the boards that failed and keeps the distinct HTTP codes", () => {
    const log = [
      ...HEAD,
      redditSkip("/r/SideProject", "week", "403"), redditOk("/r/SaaS"), redditSkip("/r/microsaas", "week", "429"),
      redditSkip("/r/Entrepreneur", "week", "403"), redditOk("/r/sidehustle"),
      "[toolify] fetched=30  new=3", ...TAIL,
    ].join("\n");
    expect(summarize(log).out).toBe("Reddit 3/5 个板块 403/429");
  });

  test("a skip without an HTTP status is still reported", () => {
    const log = [...HEAD, "[reddit] /r/SaaS skip: fetch failed", redditOk("/r/microsaas"), ...TAIL].join("\n");
    expect(summarize(log).out).toBe("Reddit 1/2 个板块 失败");
  });

  test("reports Toolify alone, and ignores a per-URL warning when the fallback URL worked", () => {
    const toolifyDown = [...HEAD, ...REDDIT_PATHS.map(([p]) => redditOk(p)), "[toolify] https://www.toolify.ai/category/most-monthly-visits failed: x", "[toolify] unreachable — 后续可走 Firecrawl MCP", ...TAIL].join("\n");
    expect(summarize(toolifyDown).out).toBe("Toolify 不可达");
    const fallbackWorked = [...HEAD, ...REDDIT_PATHS.map(([p]) => redditOk(p)), "[toolify] https://www.toolify.ai/category/most-monthly-visits failed: x", "[toolify] fetched=30  new=3", ...TAIL].join("\n");
    expect(summarize(fallbackWorked).out).toBe("");
  });

  test("log text that merely mentions the source names is not counted", () => {
    const log = [...HEAD, "codex: reading notes about [reddit] /r/SaaS skip: 403 and [toolify] unreachable", ...TAIL].join("\n");
    expect(summarize(log).out).toBe("");
  });
});

// ---- proxy preflight ----

type Hit = { method: string; url: string };

function loopbackProxy(status: number) {
  const hits: Hit[] = [];
  const server = Bun.serve({ port: 0, fetch(req) { hits.push({ method: req.method, url: req.url }); return new Response(null, { status }); } });
  return { server, hits, url: `http://127.0.0.1:${server.port}` };
}

describe("public_signal_preflight", () => {
  // async spawn: the loopback proxy lives in this process, so the event loop must stay free to answer curl
  const preflight = async (proxy: string, url: string) =>
    await Bun.spawn({
      cmd: ["/bin/bash", "-c", 'source "$1"; public_signal_preflight', "--", script],
      stdout: "ignore", stderr: "ignore",
      env: {
        ...process.env, SMART_PROGRAMS_LIBRARY_ONLY: "1", LOGDIR: mkdtempSync(join(tmpdir(), "smart-programs-pre-")),
        SMART_PROGRAMS_PROXY_URL: proxy, SMART_PROGRAMS_PREFLIGHT_URL: url, NO_PROXY: "", no_proxy: "",
      },
    }).exited;

  test("passes when the probe URL answers through the proxy", async () => {
    const p = loopbackProxy(200);
    try {
      expect(await preflight(p.url, "http://hn.example.invalid/api/probe")).toBe(0);
      expect(p.hits.length).toBe(1);
      expect(p.hits[0].url).toContain("hn.example.invalid");
    } finally { p.server.stop(true); }
  });

  test("fails when the probe URL is refused", async () => {
    const p = loopbackProxy(403);
    try {
      expect(await preflight(p.url, "http://hn.example.invalid/api/probe")).not.toBe(0);
    } finally { p.server.stop(true); }
  });

  test("the default probe is the Hacker News API the scan really uses, not toolify.ai", () => {
    const text = readFileSync(script, "utf8");
    expect(text).not.toMatch(/curl[^\n]*toolify\.ai/);
    expect(text).toMatch(/SMART_PROGRAMS_PREFLIGHT_URL:-https:\/\/hn\.algolia\.com\//);
  });
});

// ---- whole script with stubs: what Hermes would send to Feishu ----

function stub(path: string, body: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
}

async function dailyRun(opts: { scanLog: string; scanExit?: number; proxy?: string; preflightUrl?: string; oldLog?: string }) {
  const root = mkdtempSync(join(tmpdir(), "smart-programs-e2e-"));
  dirs.push(root);
  const repo = join(root, "repo");
  const logs = join(root, "logs");
  const sent = join(root, "hermes-message.txt");
  mkdirSync(join(repo, "node_modules"), { recursive: true });
  mkdirSync(logs);
  if (opts.oldLog) writeFileSync(join(logs, "smart-programs-daily.log"), opts.oldLog);
  writeFileSync(join(root, "scan.log"), opts.scanLog);
  // The script puts $HOME/.bun/bin first on PATH, so a stub bun there replaces the real one.
  stub(join(root, "home", ".bun", "bin", "bun"), `
case "$*" in
  "run scan:daily") cat "${join(root, "scan.log")}"; exit ${opts.scanExit ?? 0} ;;
  "run scripts/daily-digest.ts") mkdir -p daily; d="$(date +%F)"; echo md > "daily/$d.md"; echo html > "daily/$d.html" ;;
  "run scripts/notify-feishu.ts") printf 'BRIEFING' ;;
esac
exit 0`);
  stub(join(root, "bin", "git"), "exit 0");
  stub(join(root, "bin", "codex"), "exit 0");
  stub(join(root, "bin", "hermes"), `printf '%s' "$4" > "${sent}"`);
  const python = Bun.which("python3");
  const proc = Bun.spawn({
    cmd: ["/bin/bash", script],
    cwd: repo,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      HOME: join(root, "home"),
      SMART_PROGRAMS_DIR: repo,
      LOGDIR: logs,
      SITE_URL: "http://site.example.invalid:8082",
      SMART_PROGRAMS_GIT_BIN: join(root, "bin", "git"),
      SMART_PROGRAMS_PYTHON_BIN: python ?? "",
      CODEX_BIN: join(root, "bin", "codex"),
      HERMES: join(root, "bin", "hermes"),
      FEISHU_TARGET: "test-target",
      FEISHU_WEBHOOK: "",
      TASK_BRIDGE: "/nonexistent",
      SMART_PROGRAMS_PROXY_URL: opts.proxy ?? "",
      SMART_PROGRAMS_PREFLIGHT_URL: opts.preflightUrl ?? "",
      // bash 3.2 under a UTF-8 locale reads a multibyte character glued to $VAR as part of the name
      LC_ALL: "en_US.UTF-8", NO_PROXY: "", no_proxy: "",
    },
  });
  return {
    code: await proc.exited,
    message: existsSync(sent) ? readFileSync(sent, "utf8") : null,
    log: readFileSync(join(logs, "smart-programs-daily.log"), "utf8"),
  };
}

describe("daily-scan.sh degradation notice", () => {
  test("a healthy scan sends no 降级说明", async () => {
    const r = await dailyRun({ scanLog: allHealthy });
    expect(r.code).toBe(0);
    expect(r.message).toBe("BRIEFING");
  });

  test("blocked Reddit and unreachable Toolify are listed, with no proxy-preflight claim", async () => {
    const r = await dailyRun({ scanLog: allRedditBlocked });
    expect(r.code).toBe(0);
    expect(r.message).toBe("BRIEFING\n\n⚠️ 降级说明：Reddit 9/9 个板块 403；Toolify 不可达");
    expect(r.message).not.toContain("预检");
    expect(r.log).toContain("Reddit 9/9 个板块 403；Toolify 不可达");
  });

  test("failures already in the log from an earlier run do not leak into today's notice", async () => {
    const r = await dailyRun({ scanLog: allHealthy, oldLog: allRedditBlocked });
    expect(r.message).toBe("BRIEFING");
  });

  test("a scan that exits non-zero keeps its own notice and appends what the log shows", async () => {
    const r = await dailyRun({ scanLog: allRedditBlocked, scanExit: 1 });
    expect(r.message).toBe("BRIEFING\n\n⚠️ 降级说明：公开信号采集部分失败或超时；Reddit 9/9 个板块 403；Toolify 不可达");
  });

  test("a proxy that passes the probe URL raises no preflight notice and never asks for toolify.ai", async () => {
    const p = loopbackProxy(200);
    try {
      const r = await dailyRun({ scanLog: allHealthy, proxy: p.url, preflightUrl: "http://hn.example.invalid/api/probe" });
      expect(r.message).toBe("BRIEFING");
      expect(p.hits.every((h) => !h.url.includes("toolify"))).toBe(true);
    } finally { p.server.stop(true); }
  });

  test("a proxy that refuses the probe still raises the preflight notice", async () => {
    const p = loopbackProxy(403);
    try {
      const r = await dailyRun({ scanLog: allHealthy, proxy: p.url, preflightUrl: "http://hn.example.invalid/api/probe" });
      expect(r.message).toContain("⚠️ 降级说明：公开信号代理预检未通过");
    } finally { p.server.stop(true); }
  });
});
