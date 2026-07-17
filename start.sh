#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$SCRIPT_DIR/.run"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"

backend_pid=""
frontend_pid=""
cleanup_done=0

cleanup() {
  if [[ "$cleanup_done" -eq 1 ]]; then
    return
  fi

  cleanup_done=1

  if [[ -n "$frontend_pid" ]] && kill -0 "$frontend_pid" 2>/dev/null; then
    kill "$frontend_pid" 2>/dev/null || true
    wait "$frontend_pid" 2>/dev/null || true
  fi

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi

  rm -f "$BACKEND_PID_FILE" "$FRONTEND_PID_FILE"
  rmdir "$RUN_DIR" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$RUN_DIR"

if [[ -x "$SCRIPT_DIR/.venv/bin/uvicorn" ]]; then
  uvicorn_bin="$SCRIPT_DIR/.venv/bin/uvicorn"
elif command -v uvicorn >/dev/null 2>&1; then
  uvicorn_bin="$(command -v uvicorn)"
else
  echo "uvicorn was not found. Expected $SCRIPT_DIR/.venv/bin/uvicorn or a global uvicorn." >&2
  exit 1
fi

cd "$SCRIPT_DIR"

"$uvicorn_bin" backend.main:app &
backend_pid=$!
echo "$backend_pid" > "$BACKEND_PID_FILE"

cd "$SCRIPT_DIR/frontend"
bun run build

bun run preview &
frontend_pid=$!
echo "$frontend_pid" > "$FRONTEND_PID_FILE"

wait "$frontend_pid"