#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

CC_MANAGER_HOST="${CC_MANAGER_HOST:-127.0.0.1}"
CC_MANAGER_PORT="${CC_MANAGER_PORT:-8787}"
CC_WEB_HOST="${CC_WEB_HOST:-127.0.0.1}"
CC_WEB_PORT="${CC_WEB_PORT:-5173}"

cleanup() {
  if [[ -n "${OPEN_PID:-}" ]] && kill -0 "$OPEN_PID" 2>/dev/null; then
    kill "$OPEN_PID" 2>/dev/null || true
    wait "$OPEN_PID" 2>/dev/null || true
  fi

  if [[ -n "${VITE_PID:-}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi

  if [[ -n "${MANAGER_PID:-}" ]] && kill -0 "$MANAGER_PID" 2>/dev/null; then
    kill "$MANAGER_PID" 2>/dev/null || true
    wait "$MANAGER_PID" 2>/dev/null || true
  fi
}

open_browser_when_ready() {
  local tries=0
  while [[ "$tries" -lt 120 ]]; do
    if curl --silent --fail "http://${CC_WEB_HOST}:${CC_WEB_PORT}" >/dev/null 2>&1; then
      open "http://${CC_WEB_HOST}:${CC_WEB_PORT}" >/dev/null 2>&1 || true
      return 0
    fi
    tries=$((tries + 1))
    sleep 0.25
  done

  return 0
}

trap cleanup EXIT INT TERM

cd "$ROOT_DIR"
echo "Starting manager on ${CC_MANAGER_HOST}:${CC_MANAGER_PORT}"
CC_MANAGER_HOST="$CC_MANAGER_HOST" CC_MANAGER_PORT="$CC_MANAGER_PORT" bun run services/cc-manager/src/main.ts &
MANAGER_PID=$!

echo "Starting web UI dev server on http://${CC_WEB_HOST}:${CC_WEB_PORT}"
cd "$ROOT_DIR/services/cc-manager/web"
CC_MANAGER_PORT="$CC_MANAGER_PORT" node ./node_modules/vite/bin/vite.js --host "$CC_WEB_HOST" --port "$CC_WEB_PORT" --strictPort &
VITE_PID=$!

open_browser_when_ready &
OPEN_PID=$!

while true; do
  if ! kill -0 "$MANAGER_PID" 2>/dev/null; then
    wait "$MANAGER_PID"
    exit $?
  fi

  if ! kill -0 "$VITE_PID" 2>/dev/null; then
    wait "$VITE_PID"
    exit $?
  fi

  sleep 1
done
