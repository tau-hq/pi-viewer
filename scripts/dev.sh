#!/usr/bin/env bash
# Start the Tau host and the Vite dev server together (Ctrl+C stops both).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH=/usr/local/bin:$PATH
cd "$ROOT/packages/host" && ../../node_modules/.bin/tsx watch src/cli.ts --cwd "${TAU_DEFAULT_CWD:-$ROOT}" "$@" &
HOST_PID=$!
cd "$ROOT/packages/client" && ../../node_modules/.bin/vite --host 127.0.0.1 &
VITE_PID=$!
trap 'kill $HOST_PID $VITE_PID 2>/dev/null || true' EXIT INT TERM
wait
