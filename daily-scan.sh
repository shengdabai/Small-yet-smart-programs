#!/usr/bin/env bash
#
# 每日 12:30 编排:采集 → LLM 评分 → 双语日报 → 建站 → git 留档 → 同步上海云 → 飞书
# 幂等(当天成功后跳过)+ 进程锁 + 单源/单步失败不阻断整体。
#
# 手动跑:  bash daily-scan.sh
# 强制重跑:rm ~/.claude/logs/.smart-programs-done-$(date +%F) && bash daily-scan.sh
#
set -uo pipefail
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"

# ---- 可配置 ----
REPO="${SMART_PROGRAMS_DIR:-$HOME/.local/share/smart-programs}"
SITE_URL="${SITE_URL:-http://YOUR_SERVER:8082}"
SHANGHAI_DEST="${SHANGHAI_DEST:-shanghai:/var/www/smart-programs}"   # SSH alias:port 见 ~/.ssh/config
FEISHU_WEBHOOK="${FEISHU_WEBHOOK:-}"                                  # 飞书自定义机器人 webhook(优先;链接可点)
FEISHU_TARGET="${FEISHU_TARGET:-}"                                    # 飞书 DM(hermes fallback,纯文本;形如 feishu:oc_xxx)
# ----------------

LOGDIR="${SMART_PROGRAMS_LOGDIR:-$HOME/.claude/logs}"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/smart-programs-daily.log"
DATE="$(date +%F)"
DONE="$LOGDIR/.smart-programs-done-$DATE"
LOCK_DIR="$LOGDIR/.smart-programs.lock"
# A dead process can leave its directory lock behind. Keep it long enough that
# an owner has time to write its metadata, then reclaim it only after its PID
# is no longer alive. Override only for a deliberately chosen operational SLA.
LOCK_STALE_SECONDS="${SMART_PROGRAMS_LOCK_STALE_SECONDS:-900}"

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

remove_owned_lock_dir() {
  local dir="$1"
  rm -f "$dir/pid" "$dir/started"
  rmdir "$dir" 2>/dev/null || true
}

release_lock() {
  remove_owned_lock_dir "$LOCK_DIR"
}

acquire_lock() {
  # Every acquisition uses the same kernel guard. It covers initial directory
  # creation as well as recovery, so a crash between mkdir and metadata writes
  # cannot leave an ambiguous lock: once the guard is available, no creator is
  # still in that critical section.
  command -v python3 >/dev/null 2>&1 || {
    log "python3 is unavailable; refusing lock acquisition"
    return 1
  }
  python3 - "$LOCK_DIR" "$LOCK_STALE_SECONDS" "$$" <<'PY'
import fcntl
import os
import sys
import time

lock_dir, stale_after, owner_pid = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
guard_path = f"{lock_dir}.recovery.lock"
guard = os.open(guard_path, os.O_CREAT | os.O_RDWR, 0o600)

def positive_integer(value: str) -> bool:
    return value.isascii() and value.isdecimal() and not value.startswith("0")

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

def create_owned_lock(directory: str) -> None:
    os.mkdir(directory, 0o700)
    with open(os.path.join(directory, "pid"), "x", encoding="ascii") as file:
        file.write(f"{owner_pid}\n")
    with open(os.path.join(directory, "started"), "x", encoding="ascii") as file:
        file.write(f"{int(time.time())}\n")

def remove_stale_directory(directory: str) -> None:
    # Only remove known lock metadata and legacy reclaim artifacts after this
    # process has atomically renamed the directory out of the live pathname.
    reclaim = os.path.join(directory, ".reclaim")
    try:
        if os.path.isdir(reclaim):
            for name in ("pid", "started"):
                try:
                    os.unlink(os.path.join(reclaim, name))
                except FileNotFoundError:
                    pass
            os.rmdir(reclaim)
        else:
            os.unlink(reclaim)
    except FileNotFoundError:
        pass
    for name in ("pid", "started"):
        try:
            os.unlink(os.path.join(directory, name))
        except FileNotFoundError:
            pass
    os.rmdir(directory)

try:
    try:
        fcntl.lockf(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit(1)

    if not os.path.exists(lock_dir):
        create_owned_lock(lock_dir)
        sys.exit(0)

    metadata = read_metadata(lock_dir)
    if metadata is None:
        # Because all creators hold the guard, incomplete metadata can only
        # belong to a crashed/legacy creator. Still honor the age threshold to
        # make rolling upgrades conservative.
        try:
            started = int(os.stat(lock_dir).st_mtime)
        except OSError:
            sys.exit(1)
    else:
        pid, started = metadata
        if owner_is_alive(pid):
            sys.exit(1)
    if time.time() - started < stale_after:
        sys.exit(1)

    stale_dir = f"{lock_dir}.stale.{os.getpid()}.{time.time_ns()}"
    os.rename(lock_dir, stale_dir)
    try:
        create_owned_lock(lock_dir)
    except FileExistsError:
        # A normal contender acquired the now-free pathname first. It owns the
        # lock; do not touch it or report a successful recovery.
        sys.exit(1)
    try:
        remove_stale_directory(stale_dir)
    except OSError:
        # The new lock is valid. Leave unexpected stale contents for manual
        # inspection rather than failing after ownership was established.
        pass
    sys.exit(0)
finally:
    os.close(guard)
PY
  local status=$?
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  log "lock is active, recent, or being acquired — skip"
  return "$status"
}

# Sourcing exposes the lock helpers to the focused regression test without
# executing the production pipeline.
if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  return 0
fi

[ -f "$DONE" ] && { log "already done $DATE — skip"; exit 0; }
acquire_lock || exit 0
trap release_lock EXIT
trap 'exit 1' HUP INT TERM

cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
log "=== start $DATE (repo=$REPO) ==="

[ -d node_modules ] || bun install >>"$LOG" 2>&1

git pull --rebase >>"$LOG" 2>&1 || log "git pull failed (continuing)"

# 1) 采集增量公开信号
bun run scan:daily >>"$LOG" 2>&1 || log "scan:daily had per-source errors (continuing)"

# 2) LLM 评分:用 Claude Code 跑 skill,仅对未评分候选粗筛+7维评分入库(不重复采集、不出 HTML)
# Least privilege: unattended runs cannot approve writes, so they retain the
# existing scores instead of granting Claude broad filesystem permissions.
if command -v claude >/dev/null 2>&1; then
  claude -p "运行 smart-programs 技能的评分环节:只对机会库里本月未评分(scored.total IS NULL)的候选做 4 问粗筛 + 7 维 OPC 评分并写回 scored 表;不要重复采集信号源,不要生成 HTML 报告。读 prompts/coarse-filter.md 和 prompts/opc-score.md 作为评分规则,读 config/profile.local.json 作为运营者画像。完成后只回一行统计(评了几个、各 tier 几个)。" \
    --permission-mode manual \
    --allowedTools "Read,Glob,Grep" >>"$LOG" 2>&1 \
    || log "claude scoring skipped: unattended runs do not write scores without manual approval; existing scores will be used"
else
  log "claude CLI not found — skipping LLM scoring, using existing scores"
fi

# 3) 生成中英双语日报
bun run scripts/daily-digest.ts >>"$LOG" 2>&1 || { log "FATAL: daily-digest failed"; exit 1; }

# 4) 组装静态站
bun run scripts/build-site.ts >>"$LOG" 2>&1 || log "build-site failed (continuing)"

# 5) git 留档(只 add daily/,运行时数据已被 .gitignore 挡住)
git add daily/ >>"$LOG" 2>&1
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
