#!/usr/bin/env bash
#
# 每日 12:30 编排:采集 → Codex 评分 → 双语日报 → 建站 → git 留档 → 同步上海云 → 飞书
# 幂等(当天成功后跳过)+ 进程锁 + 单源/单步失败不阻断整体。
#
# 手动跑:  bash daily-scan.sh
# 强制重跑:rm "${LOGDIR:-$REPO/.logs}/.smart-programs-done-$(date +%F)" && bash daily-scan.sh
#
set -uo pipefail
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

# ---- 可配置 ----
REPO="${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
SITE_URL="${SITE_URL:-http://YOUR_SERVER:8082}"
SHANGHAI_DEST="${SHANGHAI_DEST:-shanghai:/var/www/smart-programs}"   # SSH alias:port 见 ~/.ssh/config
FEISHU_WEBHOOK="${FEISHU_WEBHOOK:-}"                                  # 飞书自定义机器人 webhook(优先;链接可点)
FEISHU_TARGET="${FEISHU_TARGET:-}"                                    # 飞书 DM(hermes fallback,纯文本;形如 feishu:oc_xxx)
CODEX_BIN="${CODEX_BIN:-}"                                            # launchd 建议显式传入 command -v codex 的结果
CODEX_TIMEOUT_SECONDS="${CODEX_TIMEOUT_SECONDS:-900}"
# ----------------

LOGDIR="${LOGDIR:-$REPO/.logs}"; mkdir -p "$LOGDIR"

LOG="$LOGDIR/smart-programs-daily.log"
DATE="$(date +%F)"
DONE="$LOGDIR/.smart-programs-done-$DATE"
LOCKD="$LOGDIR/.smart-programs.lockd"   # mkdir 原子锁(macOS 无 flock)

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

run_scoring() {
  local codex_bin="$CODEX_BIN"
  if [ -z "$codex_bin" ]; then
    codex_bin="$(command -v codex 2>/dev/null || true)"
  fi
  if [ -z "$codex_bin" ] || [ ! -x "$codex_bin" ]; then
    log "codex CLI not found — skipping LLM scoring, using existing scores"
    return 127
  fi
  if ! command -v timeout >/dev/null 2>&1; then
    log "timeout command not found — refusing unbounded Codex scoring"
    return 127
  fi

  timeout "$CODEX_TIMEOUT_SECONDS" "$codex_bin" exec \
    -C "$REPO" \
    --sandbox workspace-write \
    --config 'approval_policy="never"' \
    --config 'model_reasoning_effort="high"' \
    --dangerously-bypass-hook-trust \
    --color never \
    '运行机会简报评分：读 .agents/skills/smart-programs-scoring/SKILL.md 并执行。' \
    >>"$LOG" 2>&1
}

if [ "${1:-}" = "--score-only" ]; then
  cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
  run_scoring
  exit $?
fi

# 检查 SITE_URL 是否仍为占位符
if [[ "$SITE_URL" == *"YOUR_SERVER"* ]]; then
  echo "[warn] SITE_URL 仍为占位符 ($SITE_URL)，飞书消息中的链接将无效。请设置 SITE_URL 环境变量。" >&2
fi

[ -f "$DONE" ] && { log "already done $DATE — skip"; exit 0; }

# mkdir 原子锁(macOS 无 flock(1))。持锁进程已死则抢锁,防卡死永久占用。
if ! mkdir "$LOCKD" 2>/dev/null; then
  OLDPID="$(cat "$LOCKD/pid" 2>/dev/null || true)"
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null; then
    log "another run (pid $OLDPID) holds the lock — skip"; exit 0
  fi
  log "stale lock (pid ${OLDPID:-?} dead) — taking over"
  rm -rf "$LOCKD"; mkdir "$LOCKD" 2>/dev/null || { log "lock race — skip"; exit 0; }
fi
echo "$$" > "$LOCKD/pid"
trap 'rm -rf "$LOCKD" 2>/dev/null' EXIT

cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
log "=== start $DATE (repo=$REPO) ==="

[ -d node_modules ] || bun install >>"$LOG" 2>&1

git pull --rebase >>"$LOG" 2>&1 || log "git pull failed (continuing)"

# 1) 采集增量公开信号
bun run scan:daily >>"$LOG" 2>&1 || log "scan:daily had per-source errors (continuing)"

# 2) LLM 评分:用 Codex 跑评分专用 skill(不重复采集、不出 HTML)
run_scoring || log "codex scoring step failed (continuing with existing scores)"

# 3) 生成中英双语日报
bun run scripts/daily-digest.ts >>"$LOG" 2>&1 || { log "FATAL: daily-digest failed"; exit 1; }

# 4) 组装静态站
bun run scripts/build-site.ts >>"$LOG" 2>&1 || log "build-site failed (continuing)"

# 4.5) 重建 README 首页的每日简报索引(逐日链接列表)
bun run scripts/gen-readme-index.ts >>"$LOG" 2>&1 || log "gen-readme-index failed (continuing)"

# 5) git 留档(add daily/ + README 索引,运行时数据已被 .gitignore 挡住)
git add daily/ README.md >>"$LOG" 2>&1
if ! git diff --cached --quiet; then
  git commit -m "daily briefing $DATE" >>"$LOG" 2>&1 || log "commit failed"
  git push >>"$LOG" 2>&1 || log "git push failed (will retry next run)"
else
  log "no daily/ changes to commit"
fi

# 6) 同步到上海云(国内可访问)
if [ -d site ]; then
  rsync -az --delete site/ "$SHANGHAI_DEST/" >>"$LOG" 2>&1 || log "rsync to shanghai failed"
fi

# 7) 飞书推送:优先 webhook(post 富文本,链接可点),否则 hermes(纯文本)
HERMES="${HERMES:-$HOME/.local/bin/hermes}"
if [ -n "$FEISHU_WEBHOOK" ]; then
  FEISHU_WEBHOOK="$FEISHU_WEBHOOK" SITE_URL="$SITE_URL" bun run scripts/notify-feishu.ts --webhook >>"$LOG" 2>&1 \
    && log "feishu pushed (webhook, clickable)" \
    || log "feishu webhook failed"
elif [ -n "$FEISHU_TARGET" ] && [ -x "$HERMES" ]; then
  MSG="$(SITE_URL="$SITE_URL" bun run scripts/notify-feishu.ts 2>>"$LOG")"
  [ -n "$MSG" ] && "$HERMES" send -t "$FEISHU_TARGET" "$MSG" >>"$LOG" 2>&1 \
    && log "feishu pushed (hermes text)" \
    || log "feishu hermes failed"
else
  log "no FEISHU_WEBHOOK/FEISHU_TARGET — skipping Feishu push"
fi

touch "$DONE"
log "=== done $DATE ==="
