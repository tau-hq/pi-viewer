#!/usr/bin/env bash
# Start the Tauri debug build under a virtual X server, wait for the window, take a screenshot.
# Usage: e2e/desktop-smoke.sh [output.png]   (requires Xvfb, imagemagick, x11-utils and a prior `cargo build`)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/e2e/shots/desktop.png}"
TAURI="$ROOT/packages/desktop/src-tauri"
TRIPLE="$(rustc -vV 2>/dev/null | awk '/^host:/{print $2}')"
[ -x "$TAURI/target/debug/tau" ] || { echo "build first: (cd $TAURI && cargo build)" >&2; exit 1; }
cp "$TAURI/binaries/tau-node-$TRIPLE" "$TAURI/target/debug/tau-node"
Xvfb :99 -screen 0 1400x900x24 >/dev/null 2>&1 &
XPID=$!
trap 'pkill -f "target/debug/tau-nod[e]" || true; kill $APP $XPID 2>/dev/null || true' EXIT
sleep 1
(cd "$TAURI/target/debug" && DISPLAY=:99 ./tau >/dev/null 2>&1) &
APP=$!
WIN=""
for _ in $(seq 1 60); do
	WIN="$(DISPLAY=:99 xwininfo -root -tree 2>/dev/null | awk '/"Tau": \("tau"/ && $0 !~ /10x10/ {print $1; exit}')"
	[ -n "$WIN" ] && break
	sleep 1
done
[ -n "$WIN" ] || { echo "no Tau window appeared" >&2; exit 1; }
# The webview needs a moment to paint; capture the window itself, not the root.
sleep 8
DISPLAY=:99 import -window "$WIN" "$OUT"
echo "screenshot: $OUT"
tail -5 "$HOME/.local/share/app.pitau.tau/logs/Tau.log" 2>/dev/null || true
