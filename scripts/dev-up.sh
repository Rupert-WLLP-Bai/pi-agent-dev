#!/usr/bin/env bash
# Starts the local development stack and keeps it running.
#
# PostgreSQL is expected from `docker compose up -d postgres` (see
# docs/runbook/mvp-local.md); this script only manages the API and web servers.
#
#   ./scripts/dev-up.sh            # start API + web
#   ./scripts/dev-up.sh --status   # show what is running
#   ./scripts/dev-up.sh --stop     # stop both
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.dev"
API_LOG="$RUN_DIR/api.log"
WEB_LOG="$RUN_DIR/web.log"
API_PID="$RUN_DIR/api.pid"
WEB_PID="$RUN_DIR/web.pid"

mkdir -p "$RUN_DIR"

is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# Each server is launched with setsid, so its PID is also its process-group ID.
# Signalling the group is required: `bun --filter` exits while the vite child it
# spawned keeps the port bound.
stop_one() {
  local name="$1" pid_file="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done
      kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
      echo "stopped $name (pid $pid)"
    fi
  fi
  rm -f "$pid_file"
}

# Last-resort cleanup so a stale listener cannot block the next start.
free_port() {
  local port="$1"
  local pids
  pids="$(ss -tlnpH "sport = :$port" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u || true)"
  for pid in $pids; do
    echo "port $port still held by pid $pid; terminating" >&2
    kill -TERM "$pid" 2>/dev/null || true
  done
}

require_postgres() {
  if ! (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
    echo "PostgreSQL is not reachable on 127.0.0.1:5432." >&2
    echo "Start it with: docker compose up -d postgres" >&2
    exit 1
  fi
}

wait_for_port() {
  local port="$1" name="$2" log="$3"
  for _ in $(seq 1 120); do
    if (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "$name did not open port $port; last log lines:" >&2
  tail -20 "$log" >&2 || true
  exit 1
}

case "${1:-}" in
  --status)
    is_running "$API_PID" && echo "api: running (pid $(cat "$API_PID"))" || echo "api: stopped"
    is_running "$WEB_PID" && echo "web: running (pid $(cat "$WEB_PID"))" || echo "web: stopped"
    exit 0
    ;;
  --stop)
    stop_one "web" "$WEB_PID"
    stop_one "api" "$API_PID"
    exit 0
    ;;
  --help|-h)
    sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *)
    echo "unknown option: $1 (try --help)" >&2
    exit 2
    ;;
esac

require_postgres

# A leftover server on either port would make the app or proxy inconsistent.
stop_one "web" "$WEB_PID"
stop_one "api" "$API_PID"
free_port 3000
free_port 5173

(
  cd "$ROOT"
  set -a
  # shellcheck disable=SC1091
  [ -f .env ] && . ./.env
  set +a
  setsid nohup bun apps/api/src/app.ts >"$API_LOG" 2>&1 &
  echo $! >"$API_PID"
)
wait_for_port 3000 "api" "$API_LOG"
echo "api: http://localhost:3000 (pid $(cat "$API_PID"))"

(
  cd "$ROOT"
  setsid nohup bun --filter @contract-audit/web dev >"$WEB_LOG" 2>&1 &
  echo $! >"$WEB_PID"
)
wait_for_port 5173 "web" "$WEB_LOG"
echo "web: http://localhost:5173 (pid $(cat "$WEB_PID"))"

echo
echo "Open http://localhost:5173"
echo "Logs: $API_LOG , $WEB_LOG"
echo "Stop: $ROOT/scripts/dev-up.sh --stop"
