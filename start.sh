#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
    kill "$frontend_pid" "$backend_pid" 2>/dev/null || true
    wait "$frontend_pid" "$backend_pid" 2>/dev/null || true
}

trap cleanup EXIT

cd "$SCRIPT_DIR"

uvicorn_bin="${SCRIPT_DIR}/.venv/bin/uvicorn"
[[ -x "$uvicorn_bin" ]] || uvicorn_bin="$(command -v uvicorn)"

if [[ -z "${uvicorn_bin:-}" ]]; then
    echo "uvicorn not found" >&2
    exit 1
fi

"$uvicorn_bin" backend.main:app &
backend_pid=$!

cd frontend
bun run build
bun run preview &
frontend_pid=$!

wait "$frontend_pid"