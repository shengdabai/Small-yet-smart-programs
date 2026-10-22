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
GIT_BIN="${SMART_PROGRAMS_GIT_BIN:-}"                                # 避免 launchd 的 /usr/bin/git 被 Xcode 许可门禁拦截
SMART_PROGRAMS_PROXY_URL="${SMART_PROGRAMS_PROXY_URL:-}"              # 可选：本机 HTTP 代理，稳定 Bun TLS 路由
CODEX_TIMEOUT_SECONDS="${CODEX_TIMEOUT_SECONDS:-360}"
SCAN_TIMEOUT_SECONDS="${SCAN_TIMEOUT_SECONDS:-480}"
STEP_TIMEOUT_SECONDS="${STEP_TIMEOUT_SECONDS:-180}"
PREFLIGHT_URL="${SMART_PROGRAMS_PREFLIGHT_URL:-https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=1}"   # 代理预检探测点:HN 是日报真实依赖且稳定可达的源
# ----------------

LOGDIR="${LOGDIR:-$REPO/.logs}"; mkdir -p "$LOGDIR"

LOG="$LOGDIR/smart-programs-daily.log"
DATE="$(date +%F)"
DONE="$LOGDIR/.smart-programs-done-$DATE"
LOCKD="$LOGDIR/.smart-programs.lockd"   # 进程锁目录(内核 fcntl 守卫 + pid/started 元数据;archive_briefings.py 也会 mkdir 它)
LOCK_STALE_SECONDS="${SMART_PROGRAMS_LOCK_STALE_SECONDS:-900}"   # 持锁进程已死且锁龄 ≥ 此值才回收
LOCK_HELD_PID=""
FAILURE_MARK="$LOGDIR/.smart-programs-failure-notified-$DATE"
PHASE="startup"
DEGRADED_REASON=""
HERMES="${HERMES:-$HOME/.local/bin/hermes}"
TASK_BRIDGE="${TASK_BRIDGE:-$HOME/Desktop/01-项目开发/15-飞书桥接/task-progress-bridge.py}"

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

if [ -z "$GIT_BIN" ]; then
  if [ -x /opt/homebrew/bin/git ]; then
    GIT_BIN=/opt/homebrew/bin/git
  elif [ -x /usr/local/bin/git ]; then
    GIT_BIN=/usr/local/bin/git
  else
    GIT_BIN="$(command -v git 2>/dev/null || true)"
  fi
fi

if [ -n "$SMART_PROGRAMS_PROXY_URL" ]; then
  export HTTP_PROXY="$SMART_PROGRAMS_PROXY_URL" HTTPS_PROXY="$SMART_PROGRAMS_PROXY_URL" ALL_PROXY="$SMART_PROGRAMS_PROXY_URL"
  export http_proxy="$SMART_PROGRAMS_PROXY_URL" https_proxy="$SMART_PROGRAMS_PROXY_URL" all_proxy="$SMART_PROGRAMS_PROXY_URL"
  export NO_PROXY="${NO_PROXY:-localhost,127.0.0.1,::1}" no_proxy="${no_proxy:-${NO_PROXY:-localhost,127.0.0.1,::1}}"
fi

process_age_seconds() {
  local pid="$1"
  ps -p "$pid" -o etime= 2>/dev/null | awk -F '[-:]' '
    {
      gsub(/[[:space:]]/, "")
      if (NF == 4) print ($1 * 86400) + ($2 * 3600) + ($3 * 60) + $4
      else if (NF == 3) print ($1 * 3600) + ($2 * 60) + $3
      else if (NF == 2) print ($1 * 60) + $2
    }
  '
}

# ---- 进程锁 ----
# 锁目录创建、pid/started 写入、陈旧锁回收全部在同一个内核 fcntl.lockf 守卫下完成,
# 因此不会出现「有锁目录但还没写 pid」被别人当成陈旧锁抢走的窗口。
#   退出码:0 = 已持锁;75 = 锁被占用/太新/正被别人获取(跳过本次);其他 = 错误。
#   存活持有者会在 stdout 打印「HELD <pid>」,供 watchdog 计算占锁时长。
# 回收规则:持有者已死 **且** 锁龄 ≥ LOCK_STALE_SECONDS;kill -0 返回 EPERM 视为存活;
# 回收时先 rename 旧锁目录再新建,只删除已知元数据(pid/started/identity/.reclaim),不 rm -rf。
# identity = "v2 " + 持有进程启动时间(ps lstart,固定 LC_ALL=C、TZ=UTC);同 pid 进程的 v2 身份不符即视为 pid 被复用;
# 无版本前缀、读不到或 ps 失败时一律保守视为仍存活。
IFS= read -r -d '' LOCK_PY <<'PY'
from __future__ import annotations

import fcntl
import os
import subprocess
import sys
import time

BUSY = 75
lock_dir, stale_after, owner_pid = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
guard = os.open(f"{lock_dir}.recovery.lock", os.O_CREAT | os.O_RDWR, 0o600)


def positive_integer(value: str) -> bool:
    return value.isascii() and value.isdecimal() and not value.startswith("0")


def read_pid(directory: str) -> int | None:
    try:
        with open(os.path.join(directory, "pid"), encoding="ascii") as file:
            pid = file.read().strip()
    except (OSError, UnicodeDecodeError):
        return None
    return int(pid) if positive_integer(pid) else None


def read_metadata(directory: str) -> tuple[int, int] | None:
    try:
        with open(os.path.join(directory, "pid"), encoding="ascii") as file:
            pid = file.read().strip()
        with open(os.path.join(directory, "started"), encoding="ascii") as file:
            started = file.read().strip()
    except OSError:
        return None
    if not positive_integer(pid) or not positive_integer(started):
        return None
    return int(pid), int(started)


def owner_is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


IDENTITY_VERSION = "v2"


def process_identity(pid: int) -> str | None:
    """Versioned process start time ("v2 <lstart>"); None when it cannot be read reliably."""
    try:
        # LC_ALL=C and TZ=UTC: the lstart text must not depend on the caller's locale or
        # time zone (launchd vs. interactive shell), or a live owner would look "reused".
        result = subprocess.run(["/bin/ps", "-o", "lstart=", "-p", str(pid)],
                                env={**os.environ, "LC_ALL": "C", "TZ": "UTC"},
                                capture_output=True, text=True, timeout=5, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    out = result.stdout.strip()
    if result.returncode != 0 or not out:
        return None
    return f"{IDENTITY_VERSION} {out}"


def lock_owner_alive(directory: str, pid: int) -> bool:
    """Alive and still the same process: a recorded identity that no longer matches means the pid was reused."""
    if not owner_is_alive(pid):
        return False
    try:
        with open(os.path.join(directory, "identity"), encoding="ascii") as file:
            recorded = file.read().strip()
    except (OSError, UnicodeDecodeError):
        return True  # older locks carry no identity: keep the conservative alive answer
    if not recorded.startswith(IDENTITY_VERSION + " "):
        return True  # unversioned identity cannot be compared safely: keep the conservative alive answer
    current = process_identity(pid)
    return current is None or current == recorded


def create_owned_lock(directory: str) -> None:
    os.mkdir(directory, 0o700)
    with open(os.path.join(directory, "pid"), "x", encoding="ascii") as file:
        file.write(f"{owner_pid}\n")
    with open(os.path.join(directory, "started"), "x", encoding="ascii") as file:
        file.write(f"{int(time.time())}\n")
    identity = process_identity(owner_pid)
    if identity:
        with open(os.path.join(directory, "identity"), "x", encoding="ascii") as file:
            file.write(f"{identity}\n")


def remove_stale_directory(directory: str) -> None:
    reclaim = os.path.join(directory, ".reclaim")
    try:
        if os.path.isdir(reclaim):
            for name in ("pid", "started", "identity"):
                try:
                    os.unlink(os.path.join(reclaim, name))
                except FileNotFoundError:
                    pass
            os.rmdir(reclaim)
        else:
            os.unlink(reclaim)
    except FileNotFoundError:
        pass
    for name in ("pid", "started", "identity"):
        try:
            os.unlink(os.path.join(directory, name))
        except FileNotFoundError:
            pass
    os.rmdir(directory)


try:
    try:
        fcntl.lockf(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(BUSY)

    if not os.path.exists(lock_dir):
        create_owned_lock(lock_dir)
        sys.exit(0)

    metadata = read_metadata(lock_dir)
    if metadata is None:
        # Incomplete metadata belongs to a crashed or legacy (pid-only) creator that may
        # not hold the guard. A readable pid that is still alive keeps the lock whatever
        # its age; only without a live owner do we fall back to the directory age.
        legacy_pid = read_pid(lock_dir)
        if legacy_pid is not None and owner_is_alive(legacy_pid):
            print(f"HELD {legacy_pid}")
            sys.exit(BUSY)
        try:
            started = int(os.stat(lock_dir).st_mtime)
        except OSError:
            sys.exit(BUSY)
    else:
        pid, started = metadata
        if lock_owner_alive(lock_dir, pid):
            print(f"HELD {pid}")
            sys.exit(BUSY)
    if time.time() - started < stale_after:
        sys.exit(BUSY)

    stale_dir = f"{lock_dir}.stale.{os.getpid()}.{time.time_ns()}"
    os.rename(lock_dir, stale_dir)
    try:
        create_owned_lock(lock_dir)
    except FileExistsError:
        # A normal contender took the now-free pathname first; it owns the lock.
        sys.exit(BUSY)
    try:
        remove_stale_directory(stale_dir)
    except OSError:
        # The new lock is valid; leave unexpected contents for manual inspection.
        pass
    sys.exit(0)
finally:
    os.close(guard)
PY

find_lock_python() {
  local candidate
  if [ -n "${SMART_PROGRAMS_PYTHON_BIN:-}" ]; then
    "$SMART_PROGRAMS_PYTHON_BIN" -c 'import fcntl' >/dev/null 2>&1 || return 1
    printf '%s' "$SMART_PROGRAMS_PYTHON_BIN"
    return 0
  fi
  for candidate in "$(command -v python3 2>/dev/null || true)" /usr/local/bin/python3 /opt/homebrew/bin/python3 /usr/bin/python3; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    "$candidate" -c 'import fcntl' >/dev/null 2>&1 || continue
    printf '%s' "$candidate"
    return 0
  done
  return 1
}

acquire_lock() {
  local py out rc
  LOCK_HELD_PID=""
  py="$(find_lock_python)" || { log "no usable python3 (needs fcntl) — cannot take the process lock"; return 2; }
  out="$("$py" -c "$LOCK_PY" "$LOCKD" "$LOCK_STALE_SECONDS" "$$" 2>>"$LOG")"
  rc=$?
  case "$rc" in
    0) return 0 ;;
    75)
      case "$out" in HELD\ *) LOCK_HELD_PID="${out#HELD }" ;; esac
      return 75
      ;;
    *)
      log "lock helper failed (rc=$rc)"
      return "$rc"
      ;;
  esac
}

# 只释放自己持有的锁,绝不动别人的锁目录。
release_lock() {
  local owner
  owner="$(cat "$LOCKD/pid" 2>/dev/null || true)"
  [ "$owner" = "$$" ] || return 0
  rm -f "$LOCKD/pid" "$LOCKD/started" "$LOCKD/identity"
  rmdir "$LOCKD" 2>/dev/null || true
}

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

send_webhook() {
  local attempt
  for attempt in 1 2 3; do
    timeout 60 env FEISHU_WEBHOOK="$FEISHU_WEBHOOK" SITE_URL="$SITE_URL" \
      DEGRADED_REASON="$DEGRADED_REASON" bun run scripts/notify-feishu.ts --webhook >>"$LOG" 2>&1 && return 0
    log "Feishu webhook 第 ${attempt} 次发送失败"
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
    timeout 30 env CODEX_NOTIFY_DISABLE=0 AI_TASK_NOTIFY_DISABLE=0 \
      /usr/bin/python3 "$TASK_BRIDGE" --source codex --event UserPromptSubmit --emit-result >/dev/null 2>&1 || true
  result="$(jq -nc --arg session_id "$stable_id" --arg turn_id "$stable_id" --arg cwd "$REPO" \
    --arg summary "$summary" \
    '{session_id:$session_id,turn_id:$turn_id,cwd:$cwd,last_assistant_message:$summary}' |
    timeout 30 env CODEX_NOTIFY_DISABLE=0 AI_TASK_NOTIFY_DISABLE=0 \
      /usr/bin/python3 "$TASK_BRIDGE" --source codex --event StopFailure --emit-result 2>/dev/null || true)"
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
  [ -n "${SCAN_OUT:-}" ] && rm -f "$SCAN_OUT"
  release_lock
  if [ "$rc" -ne 0 ] && [ ! -f "$DONE" ]; then
    notify_failure_once "任务异常退出（rc=${rc}）" || true
  fi
  return "$rc"
}

# 代理预检:经本机代理探测 HN 公开接口。不要再探测 toolify.ai —— 它对 curl 恒返回 Cloudflare 403,会让预检每天误报。
public_signal_preflight() {
  [ -n "$SMART_PROGRAMS_PROXY_URL" ] || return 0
  timeout 20 curl -x "$SMART_PROGRAMS_PROXY_URL" -fsSI "$PREFLIGHT_URL" >/dev/null 2>>"$LOG"
}

# 读本次采集输出(stdin),只按 reddit.ts / toolify.ts 固定的日志行统计真实的单源失败,例如
# 「Reddit 9/9 个板块 403；Toolify 不可达」;没有失败时输出为空。
# 行首锚定,避免日志里别处(如 Codex 输出)出现同样的字样被误计。
summarize_source_failures() {
  awk '
    /^\[reddit\] \/r\/[^ ]+ fetched=/ { total++ }
    /^\[reddit\] \/r\/[^ ]+ skip:/ {
      total++; failed++
      code = $NF
      if (code !~ /^[0-9][0-9][0-9]$/) code = "失败"
      if (!(code in seen)) { seen[code] = 1; codes = codes (codes == "" ? "" : "/") code }
    }
    /^\[toolify\] unreachable/ { toolify = 1 }
    END {
      out = ""
      if (failed > 0) out = "Reddit " failed "/" total " 个板块 " codes
      if (toolify) out = out (out == "" ? "" : "；") "Toolify 不可达"
      printf "%s", out
    }
  '
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
  fail "SITE_URL 仍为占位符 ($SITE_URL)"
fi

[ -f "$DONE" ] && { log "already done $DATE — skip"; exit 0; }

# 进程锁(见上方 acquire_lock):持锁进程存活 / 锁太新 / 正被别人获取 → 跳过本次。
PHASE="lock"
acquire_lock
LOCK_RC=$?
if [ "$LOCK_RC" -eq 75 ]; then
  if [ -n "$LOCK_HELD_PID" ]; then
    LOCK_AGE="$(process_age_seconds "$LOCK_HELD_PID" || true)"
    log "another run (pid $LOCK_HELD_PID) holds the lock — skip"
    if [ -n "$LOCK_AGE" ] && [ "$LOCK_AGE" -ge 2400 ] 2>/dev/null; then
      PHASE="lock-watchdog"
      notify_failure_once "运行中任务 PID ${LOCK_HELD_PID} 已占锁 ${LOCK_AGE} 秒，超过 40 分钟" || true
    fi
  else
    log "lock is recent or being acquired by another run — skip"
  fi
  exit 0
elif [ "$LOCK_RC" -ne 0 ]; then
  fail "无法获取进程锁（rc=${LOCK_RC}）"
fi
trap on_exit EXIT

cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
log "=== start $DATE (repo=$REPO) ==="
PHASE="dependencies"

[ -n "$GIT_BIN" ] && [ -x "$GIT_BIN" ] && "$GIT_BIN" --version >>"$LOG" 2>&1 || fail "可用的 Git 不存在（当前：${GIT_BIN:-未找到}）"
[ -d node_modules ] || timeout "$STEP_TIMEOUT_SECONDS" bun install >>"$LOG" 2>&1 || fail "bun install 失败或超时"

PHASE="repository-sync"
timeout "$STEP_TIMEOUT_SECONDS" "$GIT_BIN" pull --ff-only >>"$LOG" 2>&1 || fail "git pull --ff-only 失败或超时"

# 1) 采集增量公开信号
PHASE="source-scan"
public_signal_preflight || {
  DEGRADED_REASON="公开信号代理预检未通过"
  log "${DEGRADED_REASON}，继续采集并保留单源错误"
}
# 本次采集输出先写独立文件,再并入总日志。单源失败只从这份输出统计,总日志轮转、截断或历史内容都不影响。
SCAN_OUT="$(mktemp "$LOGDIR/.scan-daily.XXXXXX" 2>/dev/null)" || SCAN_OUT=""
SCAN_RC=0
timeout "$SCAN_TIMEOUT_SECONDS" bun run scan:daily >>"${SCAN_OUT:-$LOG}" 2>&1 || SCAN_RC=$?
# 单源失败(Reddit 403、Toolify 不可达)不会让 scan:daily 退出非 0,只能从本次输出里读出来
SOURCE_FAILURES=""
if [ -n "$SCAN_OUT" ]; then
  cat "$SCAN_OUT" >> "$LOG" 2>/dev/null || true
  SOURCE_FAILURES="$(summarize_source_failures < "$SCAN_OUT")"
  rm -f "$SCAN_OUT"
  SCAN_OUT=""
else
  log "无法创建本次采集的独立输出文件，本期不统计单源失败"
fi
if [ "$SCAN_RC" -ne 0 ]; then
  # 追加而不是覆盖:预检失败与采集失败同时发生时两条都要保留
  DEGRADED_REASON="${DEGRADED_REASON:+${DEGRADED_REASON}；}公开信号采集部分失败或超时"
  log "公开信号采集部分失败或超时（rc=${SCAN_RC}），使用已采集数据继续"
fi
if [ -n "$SOURCE_FAILURES" ]; then
  DEGRADED_REASON="${DEGRADED_REASON:+${DEGRADED_REASON}；}${SOURCE_FAILURES}"
  log "单源采集失败：${SOURCE_FAILURES}"
fi

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
"$GIT_BIN" add daily/ README.md >>"$LOG" 2>&1 || fail "git add 失败"
if ! "$GIT_BIN" diff --cached --quiet; then
  "$GIT_BIN" commit -m "daily briefing $DATE" >>"$LOG" 2>&1 || fail "git commit 失败"
  timeout "$STEP_TIMEOUT_SECONDS" "$GIT_BIN" push >>"$LOG" 2>&1 || fail "git push 失败或超时"
else
  log "no daily/ changes to commit"
fi

# 6) 同步到上海云(国内可访问)
if [ -d site ]; then
  PHASE="site-deploy"
  timeout "$STEP_TIMEOUT_SECONDS" rsync -az --delete --exclude=podcast/ site/ "$SHANGHAI_DEST/" >>"$LOG" 2>&1 || fail "rsync 上海云失败或超时"
fi

# 7) 飞书推送:优先 webhook(post 富文本,链接可点),否则 hermes(纯文本)
PHASE="feishu-delivery"
if [ -n "$FEISHU_WEBHOOK" ]; then
  send_webhook || fail "Feishu webhook 三次发送均失败"
  log "feishu pushed (webhook, clickable, receipt confirmed)"
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
