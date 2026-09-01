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
CODEX_TIMEOUT_SECONDS="${CODEX_TIMEOUT_SECONDS:-360}"
SCAN_TIMEOUT_SECONDS="${SCAN_TIMEOUT_SECONDS:-480}"
STEP_TIMEOUT_SECONDS="${STEP_TIMEOUT_SECONDS:-180}"
# ----------------

LOGDIR="${LOGDIR:-$REPO/.logs}"; mkdir -p "$LOGDIR"

LOG="$LOGDIR/smart-programs-daily.log"
DATE="$(date +%F)"
DONE="$LOGDIR/.smart-programs-done-$DATE"
LOCKD="$LOGDIR/.smart-programs.lockd"   # mkdir 原子锁(macOS 无 flock)
FAILURE_MARK="$LOGDIR/.smart-programs-failure-notified-$DATE"
PHASE="startup"
DEGRADED_REASON=""
HERMES="${HERMES:-$HOME/.local/bin/hermes}"
TASK_BRIDGE="${TASK_BRIDGE:-$HOME/Desktop/01-项目开发/15-飞书桥接/task-progress-bridge.py}"

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

send_hermes() {
  local message="$1" attempt
  [ -n "$FEISHU_TARGET" ] && [ -x "$HERMES" ] || return 1
  for attempt in 1 2 3; do
    timeout 30 "$HERMES" send -t "$FEISHU_TARGET" "$message" >>"$LOG" 2>&1 && return 0
    log "Feishu Hermes 第 ${attempt} 次发送失败"
    sleep $((attempt * 2))
  done
  return 1
}

send_bridge_failure() {
  local summary="$1" stable_id="smart-programs-${DATE}" result status
  [ -f "$TASK_BRIDGE" ] && command -v jq >/dev/null 2>&1 || return 1
  jq -nc --arg session_id "$stable_id" --arg turn_id "$stable_id" --arg cwd "$REPO" \
    --arg prompt "机会日报每日自动任务 · ${DATE}" \
    '{session_id:$session_id,turn_id:$turn_id,cwd:$cwd,prompt:$prompt}' |
    env CODEX_NOTIFY_DISABLE=0 AI_TASK_NOTIFY_DISABLE=0 \
      /usr/bin/python3 "$TASK_BRIDGE" --source codex --event UserPromptSubmit >/dev/null 2>&1 || true
  result="$(jq -nc --arg session_id "$stable_id" --arg turn_id "$stable_id" --arg cwd "$REPO" \
    --arg summary "$summary" \
    '{session_id:$session_id,turn_id:$turn_id,cwd:$cwd,last_assistant_message:$summary}' |
    env CODEX_NOTIFY_DISABLE=0 AI_TASK_NOTIFY_DISABLE=0 \
      /usr/bin/python3 "$TASK_BRIDGE" --source codex --event StopFailure 2>/dev/null || true)"
  status="$(printf '%s' "$result" | jq -r '.status // empty' 2>/dev/null || true)"
  [ "$status" = "sent" ] || [ "$status" = "deduped" ]
}

notify_failure_once() {
  local reason="$1" message
  [ -f "$FAILURE_MARK" ] && return 0
  message="❌ 机会日报 ${DATE} 未完成
阶段：${PHASE}
原因：${reason}
后续：下一定时窗口会自动重试；未建立完成标记。"
  if send_hermes "$message" || send_bridge_failure "$message"; then
    touch "$FAILURE_MARK"
    log "失败告警已确认送达"
    return 0
  fi
  log "ERROR: 失败告警两条通道均未确认"
  return 1
}

fail() {
  local reason="$1"
  log "FATAL: $reason"
  notify_failure_once "$reason" || true
  exit 1
}

on_exit() {
  local rc=$?
  rm -rf "$LOCKD" 2>/dev/null || true
  if [ "$rc" -ne 0 ] && [ ! -f "$DONE" ]; then
    notify_failure_once "任务异常退出（rc=${rc}）" || true
  fi
  return "$rc"
}

# Allows the reliability helpers to be sourced by smoke tests without running
# the daily pipeline or touching the repository.
if [ "${SMART_PROGRAMS_LIBRARY_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

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
    LOCK_AGE="$(ps -p "$OLDPID" -o etimes= 2>/dev/null | tr -d ' ' || true)"
    log "another run (pid $OLDPID) holds the lock — skip"
    if [ -n "$LOCK_AGE" ] && [ "$LOCK_AGE" -ge 1200 ] 2>/dev/null; then
      PHASE="lock-watchdog"
      notify_failure_once "运行中任务 PID ${OLDPID} 已占锁 ${LOCK_AGE} 秒，超过 20 分钟" || true
    fi
    exit 0
  fi
  log "stale lock (pid ${OLDPID:-?} dead) — taking over"
  rm -rf "$LOCKD"; mkdir "$LOCKD" 2>/dev/null || { log "lock race — skip"; exit 0; }
fi
echo "$$" > "$LOCKD/pid"
trap on_exit EXIT

cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
log "=== start $DATE (repo=$REPO) ==="
PHASE="dependencies"

[ -d node_modules ] || timeout "$STEP_TIMEOUT_SECONDS" bun install >>"$LOG" 2>&1 || fail "bun install 失败或超时"

PHASE="repository-sync"
timeout "$STEP_TIMEOUT_SECONDS" git pull --rebase >>"$LOG" 2>&1 || fail "git pull --rebase 失败或超时"

# 1) 采集增量公开信号
PHASE="source-scan"
timeout "$SCAN_TIMEOUT_SECONDS" bun run scan:daily >>"$LOG" 2>&1 || {
  DEGRADED_REASON="公开信号采集部分失败或超时"
  log "$DEGRADED_REASON，使用已采集数据继续"
}

# 2) LLM 评分:用 Codex 跑评分专用 skill(不重复采集、不出 HTML)
PHASE="llm-scoring"
run_scoring || {
  DEGRADED_REASON="${DEGRADED_REASON:+${DEGRADED_REASON}；}Codex 评分失败或超时，本期使用已有评分"
  log "codex scoring step failed (continuing with existing scores)"
}

# 3) 生成中英双语日报
PHASE="digest-build"
timeout "$STEP_TIMEOUT_SECONDS" bun run scripts/daily-digest.ts >>"$LOG" 2>&1 || fail "daily-digest 生成失败或超时"
[ -s "daily/${DATE}.md" ] && [ -s "daily/${DATE}.html" ] || fail "当日中英日报文件缺失或为空"

# 4) 组装静态站
PHASE="site-build"
timeout "$STEP_TIMEOUT_SECONDS" bun run scripts/build-site.ts >>"$LOG" 2>&1 || fail "build-site 失败或超时"

# 4.5) 重建 README 首页的每日简报索引(逐日链接列表)
timeout "$STEP_TIMEOUT_SECONDS" bun run scripts/gen-readme-index.ts >>"$LOG" 2>&1 || fail "README 索引生成失败或超时"

# 5) git 留档(add daily/ + README 索引,运行时数据已被 .gitignore 挡住)
PHASE="git-publish"
git add daily/ README.md >>"$LOG" 2>&1 || fail "git add 失败"
if ! git diff --cached --quiet; then
  git commit -m "daily briefing $DATE" >>"$LOG" 2>&1 || fail "git commit 失败"
  timeout "$STEP_TIMEOUT_SECONDS" git push >>"$LOG" 2>&1 || fail "git push 失败或超时"
else
  log "no daily/ changes to commit"
fi

# 6) 同步到上海云(国内可访问)
if [ -d site ]; then
  PHASE="site-deploy"
  timeout "$STEP_TIMEOUT_SECONDS" rsync -az --delete site/ "$SHANGHAI_DEST/" >>"$LOG" 2>&1 || fail "rsync 上海云失败或超时"
fi

# 7) 飞书推送:优先 webhook(post 富文本,链接可点),否则 hermes(纯文本)
PHASE="feishu-delivery"
if [ -n "$FEISHU_WEBHOOK" ]; then
  timeout 60 env FEISHU_WEBHOOK="$FEISHU_WEBHOOK" SITE_URL="$SITE_URL" bun run scripts/notify-feishu.ts --webhook >>"$LOG" 2>&1 \
    || fail "Feishu webhook 发送失败或超时"
  log "feishu pushed (webhook, clickable)"
elif [ -n "$FEISHU_TARGET" ] && [ -x "$HERMES" ]; then
  MSG="$(SITE_URL="$SITE_URL" bun run scripts/notify-feishu.ts 2>>"$LOG")"
  [ -n "$MSG" ] || fail "Feishu 消息生成为空"
  [ -z "$DEGRADED_REASON" ] || MSG="${MSG}

⚠️ 降级说明：${DEGRADED_REASON}"
  send_hermes "$MSG" || fail "Feishu Hermes 三次发送均失败"
  log "feishu pushed (hermes text, receipt confirmed)"
else
  fail "未配置可用的 Feishu 发送通道"
fi

touch "$DONE"
rm -f "$FAILURE_MARK"
log "=== done $DATE ==="
