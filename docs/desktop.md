# The desktop app (Tauri 2)

The desktop app is a thin Rust shell (`packages/desktop/src-tauri`) that loads the same web
client the browser gets. On launch it spawns **Node as a sidecar** running the bundled host,
waits for the host's `TAU_HOST_READY {"port":n}` line, and opens its window on
`http://127.0.0.1:<port>/`. The host serves the client from the resource folder and starts
**pi's standalone binary** (`--pi-bin`). Without the sidecar (development) the app falls back
to `http://127.0.0.1:8787/`.

**Why Node and not a compiled host binary:** `node-pty` only works under Node. Under Bun —
compiled or not — the shell inside the PTY exits immediately, which would leave the desktop
app without terminals. Node costs ~20 MB more and removes the Bun dependency entirely.

Bundled resources (`tauri.conf.json` plus per-platform overlays):

| Source | In the bundle | Purpose |
|---|---|---|
| `binaries/tau-node-<triple>` | sidecar `tau-node` | Node runtime (from nodejs.org, checksum-verified) |
| `binaries/host/cli.mjs` | `host/` | bundled host (~8 MB, pi's SDK inlined) |
| `binaries/node-pty-<os>/` | `node-pty/` | node-pty with the platform's native module |
| `binaries/pi-<os>/` | `pi/` | pi's standalone release (binary + modules + assets) |
| `../../client/dist/` | `client/` | built web client |
| `../../pi-extension/src/` | `extension/` | the Tau extension (pi loads TypeScript directly) |

## Building

Requirements: Node ≥ 22, Rust (rustup), and Tauri's system dependencies for your platform
(Windows: VS Build Tools with C++ and WebView2; Linux: `libwebkit2gtk-4.1-dev`,
`build-essential`, `librsvg2-dev`, `patchelf`; macOS: Xcode Command Line Tools).

```bash
npm install --ignore-scripts
npm run build -w @pi-tau/shared -w @pi-tau/client
scripts/prepare-sidecars.sh linux-x64        # or windows-x64, linux-arm64, darwin-arm64, darwin-x64
cd packages/desktop && ../../node_modules/.bin/tauri build --bundles deb   # nsis, appimage, dmg
```

Output lands under `packages/desktop/src-tauri/target/release/bundle/`. **Windows installers
are built on Windows** (or via `.github/workflows/desktop.yml`, which builds all three
platforms); a Linux machine can cross-prepare the Windows sidecars but not run the Windows
Tauri build.

The sidecar script reads the pi version pinned in `packages/host/package.json` and downloads
exactly that release, SHA-256-verified — the bundle always ships the tested combination.

## Development without a bundle

```bash
cd packages/desktop/src-tauri && cargo build
cp binaries/tau-node-<triple> target/debug/tau-node   # plain cargo build does not copy sidecars
./target/debug/tau
```

On a headless machine: run it under Xvfb and read the log at
`~/.local/share/app.pitau.tau/logs/Tau.log`; `e2e/desktop-smoke.sh` wires that up and takes a
screenshot.

## Known points

- The sidecar binds `127.0.0.1` on a free port; every app instance gets its own host.
  Sessions live where pi keeps them, `~/.pi/agent/sessions/`.
- Terminals need a native node-pty per platform; if it is missing the script warns and the
  app runs without terminals.
- Code signing (Windows SmartScreen, macOS Gatekeeper) is not set up yet.
