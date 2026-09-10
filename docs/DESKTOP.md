# Tau als Desktop-App (Tauri 2)

Die Desktop-App ist eine Rust-Huelle (`packages/desktop/src-tauri`), die denselben Web-Client
laedt wie der Browser. Beim Start spawnt sie **Node als Sidecar** mit dem gebuendelten Host,
wartet auf dessen Zeile `TAU_HOST_READY {"port":n}` und oeffnet das Fenster auf
`http://127.0.0.1:n/`. Der Host serviert den Client aus dem Ressourcenordner und startet
**Pis Standalone-Binary** (`--pi-bin`). Ohne Sidecar (Entwicklung) faellt die App auf
`http://127.0.0.1:8787/` zurueck.

**Warum Node und nicht ein kompiliertes Binary:** `node-pty` laeuft nur unter Node. Unter Bun
(kompiliert wie nicht kompiliert) startet die Shell im PTY und beendet sich sofort, damit waeren
die Terminals in der Desktop-App tot. Node kostet rund 20 MB mehr als ein Bun-Binary und macht
den Desktop-Build unabhaengig von Bun.

Ressourcen (`tauri.conf.json` plus `tauri.{linux,windows,macos}.conf.json`):

| Quelle | Ziel im Bundle | Zweck |
|---|---|---|
| `binaries/tau-node-<triple>` | Sidecar `tau-node` | Node-Laufzeit (von nodejs.org, Pruefsumme) |
| `binaries/host/cli.mjs` | `host/` | gebuendelter Host, rund 8 MB, Pi-SDK inline |
| `binaries/node-pty-<os>/` | `node-pty/` | node-pty mit dem nativen Modul der Plattform |
| `binaries/pi-<os>/` | `pi/` | Pis Standalone-Release (Binary + Module + Assets) |
| `../../client/dist/` | `client/` | gebauter Web-Client |
| `../../pi-extension/src/` | `extension/` | Tau-Erweiterung (Pi laedt TypeScript direkt) |

## Bauen

Voraussetzungen: Node 22, Rust (rustup), die Tauri-Systemabhaengigkeiten der Plattform
(Windows: Visual Studio Build Tools mit C++ und WebView2; Linux: `libwebkit2gtk-4.1-dev`
`build-essential` `librsvg2-dev` `patchelf`; macOS: Xcode Command Line Tools).

```bash
npm install --ignore-scripts
./node_modules/.bin/tsc -b packages/client && (cd packages/client && ../../node_modules/.bin/vite build)
scripts/prepare-sidecars.sh windows-x64      # oder linux-x64, linux-arm64, darwin-arm64
cd packages/desktop && ../../node_modules/.bin/tauri build --bundles nsis   # deb, appimage, dmg
```

Ergebnis unter `packages/desktop/src-tauri/target/release/bundle/`. **Windows-Pakete entstehen nur
auf Windows** (oder ueber `.github/workflows/desktop.yml`); der VPS (Linux arm64) kann den Host
fuer Windows cross-kompilieren und Pis Windows-Release laden, aber Tauri nicht fuer Windows bauen.

Pi-Version: das Skript liest die in `packages/host/package.json` gepinnte Version und laedt genau
dieses Release (mit SHA256-Pruefung). Host und Pi im Bundle sind damit immer die getestete Kombination.

## Entwicklung ohne Bundle

```bash
cd packages/desktop/src-tauri && cargo build
cp binaries/tau-node-<triple> target/debug/tau-node       # plain cargo build kopiert Sidecars nicht
./target/debug/tau                                          # Ressourcen liegen nach dem Build unter target/debug/
```

Auf dem VPS ohne Bildschirm: `Xvfb :99 -screen 0 1400x900x24 &`, `DISPLAY=:99 ./target/debug/tau`,
Protokoll unter `~/.local/share/app.pitau.tau/logs/Tau.log`, Screenshot mit
`DISPLAY=:99 import -window <id> shot.png`; fertig verdrahtet in `e2e/desktop-smoke.sh`. Das
Fenster erscheint erst, wenn der Sidecar bereit ist, und der Webview braucht danach ein paar
Sekunden bis zum ersten Bild.

## Bekannte Punkte

- Der Sidecar bindet nur 127.0.0.1 und waehlt einen freien Port; jede Instanz der App hat ihren
  eigenen Host. Sitzungen liegen wie bei Pi unter `~/.pi/agent/sessions/`.
- Werkzeugfreigaben: `TAU_APPROVAL` gilt fuer den Sidecar-Prozess; Standard `mutating`.
- Terminals brauchen ein natives node-pty je Plattform. Fuer Linux baut `npm install` es lokal,
  fuer Windows und macOS liegen Prebuilds im npm-Paket; fehlt eines, warnt das Skript und die
  App laeuft ohne Terminals.
- Code-Signierung (Windows SmartScreen, macOS Gatekeeper) ist noch nicht eingerichtet.
