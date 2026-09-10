#!/usr/bin/env bash
# Prepare the desktop sidecars and resources for one target platform:
#   binaries/tau-node-<triple>[.exe]  Node runtime (sidecar; node-pty only works under Node)
#   binaries/host/cli.mjs             bundled Tau host (pi's SDK inlined)
#   binaries/node-pty-<os>/           trimmed node-pty with the platform's native binding
#   binaries/pi-<os>/                 pi's standalone release, verified against SHA256SUMS
# Usage: scripts/prepare-sidecars.sh <linux-arm64|linux-x64|windows-x64|darwin-arm64|darwin-x64>
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH=/usr/local/bin:/opt/bun/bin:$PATH
TARGET="${1:-}"
case "$TARGET" in
	linux-arm64)  TRIPLE=aarch64-unknown-linux-gnu;  OS=linux;   NODE_DIST=linux-arm64;  NODE_ARCHIVE=tar.xz; PI_ASSET=pi-linux-arm64.tar.gz;  PTY_PREBUILD="" ;;
	linux-x64)    TRIPLE=x86_64-unknown-linux-gnu;   OS=linux;   NODE_DIST=linux-x64;    NODE_ARCHIVE=tar.xz; PI_ASSET=pi-linux-x64.tar.gz;    PTY_PREBUILD="" ;;
	windows-x64)  TRIPLE=x86_64-pc-windows-msvc;     OS=windows; NODE_DIST=win-x64;      NODE_ARCHIVE=zip;    PI_ASSET=pi-windows-x64.zip;    PTY_PREBUILD=win32-x64 ;;
	darwin-arm64) TRIPLE=aarch64-apple-darwin;       OS=macos;   NODE_DIST=darwin-arm64; NODE_ARCHIVE=tar.gz; PI_ASSET=pi-darwin-arm64.tar.gz; PTY_PREBUILD=darwin-arm64 ;;
	darwin-x64)   TRIPLE=x86_64-apple-darwin;        OS=macos;   NODE_DIST=darwin-x64;   NODE_ARCHIVE=tar.gz; PI_ASSET=pi-darwin-x64.tar.gz;   PTY_PREBUILD=darwin-x64 ;;
	*) echo "usage: $0 <linux-arm64|linux-x64|windows-x64|darwin-arm64|darwin-x64>" >&2; exit 2 ;;
esac
EXT=""; [ "$OS" = windows ] && EXT=".exe"
BIN="$ROOT/packages/desktop/src-tauri/binaries"
mkdir -p "$BIN"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

NODE_VERSION="$(node -p 'process.versions.node')"
PI_VERSION="$(node -p "require('$ROOT/packages/host/package.json').dependencies['@earendil-works/pi-coding-agent']")"
echo "== target $TARGET (node $NODE_VERSION, pi $PI_VERSION)"

echo "== host bundle"
if command -v bun >/dev/null; then
	bun build --target=node "$ROOT/packages/host/src/cli.ts" --outfile "$BIN/host/cli.mjs" --external node-pty
else
	# CommonJS dependencies (ws) call require() at load time, which esbuild's ESM output does not
	# provide by itself; the banner restores it.
	BANNER='import{createRequire as __tauCreateRequire}from"node:module";const require=__tauCreateRequire(import.meta.url);'
	"$ROOT/node_modules/.bin/esbuild" "$ROOT/packages/host/src/cli.ts" --bundle --platform=node --format=esm \
		--target=node22 --external:node-pty --banner:js="$BANNER" --outfile="$BIN/host/cli.mjs"
fi

echo "== node runtime"
NODE_BASE="https://nodejs.org/dist/v$NODE_VERSION"
curl -fsSL "$NODE_BASE/node-v$NODE_VERSION-$NODE_DIST.$NODE_ARCHIVE" -o "$TMP/node.$NODE_ARCHIVE"
curl -fsSL "$NODE_BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
(cd "$TMP" && grep " node-v$NODE_VERSION-$NODE_DIST.$NODE_ARCHIVE\$" SHASUMS256.txt | sed "s| node-v$NODE_VERSION-$NODE_DIST.$NODE_ARCHIVE| node.$NODE_ARCHIVE|" | sha256sum -c -)
case "$NODE_ARCHIVE" in
	tar.*) tar -xf "$TMP/node.$NODE_ARCHIVE" -C "$TMP" ;;
	zip) unzip -q "$TMP/node.$NODE_ARCHIVE" -d "$TMP" ;;
esac
NODE_EXE="$(find "$TMP" -type f -name "node$EXT" -path "*node-v$NODE_VERSION*" | head -1)"
[ -n "$NODE_EXE" ] || { echo "node executable not found in the archive" >&2; exit 1; }
cp "$NODE_EXE" "$BIN/tau-node-$TRIPLE$EXT"
chmod +x "$BIN/tau-node-$TRIPLE$EXT"
[ "$OS" = linux ] && strip "$BIN/tau-node-$TRIPLE$EXT" 2>/dev/null || true

echo "== node-pty"
SRC="$ROOT/node_modules/node-pty"
[ -d "$SRC" ] || { echo "node-pty is not installed (npm install -w @pi-tau/host node-pty)" >&2; exit 1; }
rm -rf "$BIN/node-pty-$OS"; mkdir -p "$BIN/node-pty-$OS"
cp -a "$SRC/package.json" "$SRC/lib" "$BIN/node-pty-$OS/"
if [ -n "$PTY_PREBUILD" ]; then
	if [ -d "$SRC/prebuilds/$PTY_PREBUILD" ]; then
		mkdir -p "$BIN/node-pty-$OS/prebuilds"
		cp -a "$SRC/prebuilds/$PTY_PREBUILD" "$BIN/node-pty-$OS/prebuilds/"
	else
		echo "   WARNING: no prebuild for $PTY_PREBUILD; terminals will be unavailable on $TARGET" >&2
	fi
elif [ -d "$SRC/build/Release" ]; then
	mkdir -p "$BIN/node-pty-$OS/build/Release"
	cp -a "$SRC"/build/Release/*.node "$BIN/node-pty-$OS/build/Release/"
else
	echo "   WARNING: node-pty was not built here; terminals will be unavailable on $TARGET" >&2
fi

echo "== pi $PI_VERSION standalone ($PI_ASSET)"
PI_BASE="https://github.com/earendil-works/pi/releases/download/v$PI_VERSION"
curl -fsSL "$PI_BASE/$PI_ASSET" -o "$TMP/$PI_ASSET"
curl -fsSL "$PI_BASE/SHA256SUMS" -o "$TMP/SHA256SUMS"
(cd "$TMP" && grep " $PI_ASSET\$" SHA256SUMS | sha256sum -c -)
rm -rf "$BIN/pi-$OS"; mkdir -p "$BIN/pi-$OS"
case "$PI_ASSET" in
	*.tar.gz) tar -xzf "$TMP/$PI_ASSET" -C "$TMP/pi-extract" --one-top-level 2>/dev/null || { mkdir -p "$TMP/pi-extract" && tar -xzf "$TMP/$PI_ASSET" -C "$TMP/pi-extract"; } ;;
	*.zip) mkdir -p "$TMP/pi-extract" && unzip -q "$TMP/$PI_ASSET" -d "$TMP/pi-extract" ;;
esac
PI_EXE="$(find "$TMP/pi-extract" -type f -name "pi$EXT" -not -path "*/node_modules/*" | head -1)"
[ -n "$PI_EXE" ] || { echo "pi executable not found in $PI_ASSET" >&2; find "$TMP/pi-extract" -maxdepth 3 | head -20 >&2; exit 1; }
cp -a "$(dirname "$PI_EXE")/." "$BIN/pi-$OS/"
chmod +x "$BIN/pi-$OS/pi$EXT" 2>/dev/null || true

echo "== done"
du -sh "$BIN"/* | sed 's|.*/binaries/|  |'
