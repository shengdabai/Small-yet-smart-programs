#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEST_LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/smart-programs-reliability.XXXXXX")"

cleanup() {
  find "$TEST_LOGDIR" -type f -delete 2>/dev/null || true
  rmdir "$TEST_LOGDIR" 2>/dev/null || true
}
trap cleanup EXIT

LOGDIR="$TEST_LOGDIR" \
SMART_PROGRAMS_LIBRARY_ONLY=1 \
SMART_PROGRAMS_PROXY_URL="http://127.0.0.1:7897" \
FEISHU_TARGET="test-target" \
HERMES=/usr/bin/false \
TASK_BRIDGE=/nonexistent \
bash -c '
  source "$1/daily-scan.sh"
  [ "$HTTPS_PROXY" = "$SMART_PROGRAMS_PROXY_URL" ]
  age="$(process_age_seconds $$)"
  [ -n "$age" ] && [ "$age" -ge 0 ]
  if notify_failure_once "simulated failure"; then
    exit 10
  fi
  [ ! -f "$FAILURE_MARK" ]
' _ "$REPO_ROOT"

LOGDIR="$TEST_LOGDIR" \
SMART_PROGRAMS_LIBRARY_ONLY=1 \
FEISHU_TARGET="test-target" \
HERMES=/usr/bin/true \
TASK_BRIDGE=/nonexistent \
bash -c '
  source "$1/daily-scan.sh"
  notify_failure_once "simulated failure"
  [ -f "$FAILURE_MARK" ]
' _ "$REPO_ROOT"

awk '
  /send_hermes "\$MSG"/ { send_line = NR }
  /touch "\$DONE"/ { done_line = NR }
  END {
    if (!(send_line > 0 && done_line > send_line)) exit 1
  }
' "$REPO_ROOT/daily-scan.sh"

echo "daily-scan reliability smoke tests passed"
