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

LOGDIR="$HOME/.claude/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/smart-programs-daily.log"
DATE="$(date +%F)"
DONE="$LOGDIR/.smart-programs-done-$DATE"
LOCK="$LOGDIR/.smart-programs.lock"

log(){ echo "[$(date '+%F %T')] $*" >> "$LOG"; }

[ -f "$DONE" ] && { log "already done $DATE — skip"; exit 0; }
exec 9>"$LOCK"; flock -n 9 || { log "another run holds the lock — skip"; exit 0; }

cd "$REPO" 2>/dev/null || { log "FATAL: repo not found at $REPO"; exit 1; }
log "=== start $DATE (repo=$REPO) ==="

[ -d node_modules ] || bun install >>"$LOG" 2>&1

git pull --rebase >>"$LOG" 2>&1 || log "git pull failed (continuing)"

# 1) 采集增量公开信号
bun run scan:daily >>"$LOG" 2>&1 || log "scan:daily had per-source errors (continuing)"

# 2) LLM 评分:用 Claude Code 跑 skill,仅对未评分候选粗筛+7维评分入库(不重复采集、不出 HTML)
if command -v claude >/dev/null 2>&1; then
  claude -p "运行 smart-programs 技能的评分环节:只对机会库里本月未评分(scored.total IS NULL)的候选做 4 问粗筛 + 7 维 OPC 评分并写回 scored 表;不要重复采集信号源,不要生成 HTML 报告。读 prompts/coarse-filter.md 和 prompts/opc-score.md 作为评分规则,读 config/profile.local.json 作为运营者画像。完成后只回一行统计(评了几个、各 tier 几个)。" \
    --dangerously-skip-permissions >>"$LOG" 2>&1 || log "claude scoring step failed (continuing with existing scores)"
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
