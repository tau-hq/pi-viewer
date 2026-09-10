# Pi-GUI: Architekturentscheidung (Entwurf, 2026-09-09)

Stand: Pi 0.85.1 (Upstream `ce5ec9ca3`), Fork-Spiegel unter `/srv/pi`. Grundlage sind
sieben Erkundungsberichte in `docs/research/` (drei zu Pi selbst, vier zu bestehenden
Oberflaechen). Dieses Dokument fasst zusammen und entscheidet; Details stehen dort.

## 1. Ziel und Anforderungen

Eine Web-App als GUI fuer Pi, die

- (a) spaeter mit derselben Codebasis als Desktop-App laeuft (Windows zuerst),
- (b) dunkel, modern und sehr reaktionsschnell ist (Massstab: moderne Chat-Oberflaechen wie ChatGPT),
- (c) Upstream-Updates von Pi ohne Angst mitnimmt, also additiv statt invasiv ist,
- (d) alles kann, was Pi als TUI, CLI, RPC oder SDK bietet, einschliesslich Erweiterungen.

## 2. Was die Erkundung ergeben hat

### 2.1 Upstream-Tempo

| Zeitraum | Commits auf `upstream/main` |
|---|---|
| 7 Tage | 88 |
| 30 Tage | 726 |
| 90 Tage | 1802 |

32 Tags in 90 Tagen, also ein Release etwa alle drei Tage. Das coding-agent-CHANGELOG
enthaelt in rund 40 Releases einen Abschnitt "Breaking Changes". Folge: Jede Aenderung am
Pi-Kern wird zur Dauerbaustelle. (c) ist damit die Anforderung, die die Architektur bestimmt.

### 2.2 Stabile Integrationsflaechen von Pi (heute)

1. **RPC-Modus** (`pi --mode rpc`): JSON Lines ueber stdin/stdout, dokumentiert
   (`packages/coding-agent/docs/rpc.md`), getestet, ausdruecklich "supported". Deckt ab:
   Prompt, Steer, Follow-up, Abort, Queue, Modell, Denkstufe, Kompaktierung, Auto-Retry,
   Bash mit Streaming, Fork, Clone, Sitzungswechsel, Entry-Cursor (`get_entries {since}`),
   Baum lesen, Statistiken inklusive Kontextverbrauch, HTML-Export, Befehlsliste. Dazu das
   Dialog-Unterprotokoll `extension_ui_request`/`extension_ui_response` (select, confirm,
   input, editor, notify, setStatus, setWidget, setTitle, set_editor_text).
   Fehlt: Sitzungsliste, Login, `/tree`-Navigation, Werkzeugverwaltung, JSONL-Export,
   Startoptionen zur Laufzeit.
2. **SDK** (Root-Import von `@earendil-works/pi-coding-agent`): oeffentlich, dokumentiert,
   bricht aber haeufiger als RPC. Fuer die RPC-Luecken reichen wenige Aufrufe:
   `SessionManager.list/listAll`, `ModelRuntime.login/logout/checkAuth` mit dem
   `AuthInteraction`-Callback (OAuth, Device-Code, manueller Code), `SettingsManager`.
3. **Erweiterungs-API**: Eine eigene Erweiterung (`-e gui.ts`) kann alles nachruesten, was RPC
   nicht hat: Werkzeugfreigaben ueber den `tool_call`-Hook, `/tree` ueber
   `ctx.actions.navigateTree`, Werkzeuge an/aus, Umbenennen. Erweiterungsbefehle sind ueber
   RPC als `prompt "/name args"` aufrufbar, auch waehrend eines Laufs; ihre Dialoge kommen
   als `extension_ui_request` zurueck. Das ist der Hebel, der (d) ohne Fork erfuellt.

Nicht darauf bauen: `packages/{protocol,client,server}`, `src/experimental/**`. Das ist
Upstreams kuenftige Mehrfach-Praesentations-Architektur (Chord-Services, CBOR-Protokoll,
WebSocket-Relay ueber radius.pi.dev, "pico"-Harness mit `ConversationView` +
`applyEvent`), ausdruecklich fuer Web und Mobil gedacht, aber: keine Auth, keine
Erweiterungsdialoge, keine Befehlsliste ueber die Leitung, Protokollversion ohne
Kompatibilitaetsgarantie, im npm-Paket nicht enthalten. Unsere interne Client-API soll
trotzdem die Form von `AgentController` + `Transcript`/`ConversationView` haben, damit der
spaetere Wechsel ein reiner Transport-Tausch im Host ist.

### 2.3 Erweiterungs-UI: zwei Haelften

- **Deklarativ** (im RPC bereits definiert, nativ im Browser darstellbar): select, confirm,
  input, editor, notify, setStatus, setWidget mit Textzeilen, setTitle, Editortext.
- **Komponenten-uebergebend** (nur Terminal): `custom()`, `setWidget(factory)`, `setFooter`,
  `setHeader`, `setEditorComponent`, `onTerminalInput`, Message/Entry/Tool-Renderer.
  Rueckfallebene: `packages/tui` abstrahiert das Terminal als Interface
  (`Terminal`, injizierbar ueber `createInteractiveTui({terminal})`); ein
  `VirtualTerminal` auf `@xterm/headless` existiert als Testtreiber. Zwei Wege:
  ANSI-zu-HTML fuer statische Ausgaben (Vorbild `src/core/export-html`) und ein
  xterm.js-Bereich fuer interaktive Komponenten.
- Statuszeilen und Widget-Zeilen enthalten rohes ANSI, also immer durch einen
  ANSI-Konverter, nie als `textContent`.

### 2.4 Weitere Bausteine von Pi

- Themes: JSON mit 56 Farbtoken; `getResolvedThemeColors()` liefert Hex, der HTML-Export
  schreibt sie bereits als CSS-Variablen. Pi-Themes koennen also 1:1 Web-Themes werden.
- `src/core/export-html/template.{js,css}`: fertige Darstellungsregeln fuer Markdown,
  Werkzeugkarten, Baumfilter, Suche. Als Vorlage nutzen, nicht als Laufzeitcode.
- Sitzungsdateien: JSONL unter `~/.pi/agent/sessions/`, ohne Sperren, mit fruehem
  Neuschreiben der Datei. Nie live mitlesen; Historie ueber `get_entries {since}`.
- Pi hat kein Rechtesystem. Eine Freigabe-Erweiterung ist der einzige Weg, und Pi sollte
  auf dem VPS nicht als root laufen.

### 2.5 Bestehende Oberflaechen

| Projekt | Sterne | Stack | Pi-Anbindung | Deckt (d) | Desktop (a) | Optik (b) | Kopplung (c) |
|---|---|---|---|---|---|---|---|
| agegr/pi-web | 6168 | Next.js 16, React 19, Tailwind 4, SSE | SDK im Next-Server | ca. 95 %, inkl. `custom()` ueber kopfloses TUI-Rendering; keine Freigaben | Electron mit Next-Server als Sidecar | hell, Werkzeug-Look | moderat: Dateizugriffe, Monkey-Patches |
| jmfederico/pi-web | 734 | Lit 3, eigenes CSS, Fastify, Daemon + Gateway, WS | SDK im Daemon | hoch; keine Freigaben, keine Widgets, kein Export/Share | Sidecar moeglich, Windows "nicht empfohlen" | hell, Monospace | tief: JSONL-Byte-Parsing, auth.json, gespiegelte Befehlsliste |
| Jaxton07/percho | 303 | Electron, React 19, Tailwind 4, Zustand | SDK im Electron-Main | Luecken: Dialoge abgeschaltet, kein `!`, kein Steer, kein Baum/Terminal | Windows ja (unsigniert); Browser-Variante ist zweite duenne App | dunkel, verspielt | tief plus 10k Zeilen Eigenbau; chinesisch |
| minghinmatthewlam/pi-gui | 932 | Electron, React 19, eigenes CSS mit Tokens | SDK im Electron-Main | Luecken: keine Freigaben, `custom()` verweigert, kein `!` | Windows signiert | dunkel, Codex-Stil, am naechsten an (b) | moderat; Build-Kanarien; seit 28.07. inaktiv; Vollzustand pro Token |

Keines erfuellt alle vier Anforderungen. Alle vier binden das SDK in-process; keines nutzt
Tauri; keines virtualisiert die Transkriptliste sauber.

## 3. Entscheidung

**Empfehlung: eigenes, additives Projekt (Option B), Pi bleibt unveraendert.**
Bewaehrte Bausteine der MIT-lizenzierten Kandidaten werden gezielt uebernommen.

Begruendung: (c) und (d) sind die harten Anforderungen. Option A (auf agegr/pi-web
aufsetzen) liefert (d) schnell, aber Optik, Performance und Desktop-Form widersprechen (a)
und (b), und die Kopplung an Pi laege in fremder Hand, bei zwei Upstreams statt einem.
Option B kostet mehr Anfangsarbeit, haelt aber genau eine schmale, versionierte Naht zu Pi
und erlaubt Design und Performance von Anfang an.

Der Fork unter `/srv/pi` bleibt Spiegel zum Quellstudium, Debuggen und fuer seltene
Mini-Patches. Ein Rebranding von Pi ist damit unnoetig; die GUI hat ihren eigenen Namen.

## 4. Architektur

```
Browser / Electron-Fenster
   |  WebSocket (JSON, seq-nummeriert, Snapshot + Replay) und HTTP
   v
pi-host (Node 22, eigenes Paket)
   |-- je Sitzung: Kindprozess `pi --mode rpc -e gui-extension.ts`
   |-- Adapter (eine Datei): SessionManager.list, ModelRuntime.login/logout, SettingsManager
   |-- Sitzungen leben weiter, wenn der Browser weg ist; Idle-Timeout
   v
Pi (npm, exakt gepinnt)  <--  gui-extension.ts (Freigaben, /tree, Werkzeuge, Umbenennen)
```

- **Client**: reine Web-App ohne Electron-Importe; spricht nur den WebSocket-Vertrag
  (Vorbild percho `PiApi`, pi-gui `window.piApp`). Dadurch laeuft derselbe Client im Browser
  gegen den VPS und im Desktop-Fenster gegen einen lokalen Host.
- **Host**: Prozessisolation je Sitzung (ein Absturz reisst nicht alles mit), RPC als einziger
  Streaming-Vertrag, SDK-Aufrufe in einer Adapterdatei gebuendelt. Upstream-Update =
  Version anheben, RPC-Diff lesen, Adapter pruefen, Tests laufen lassen.
- **Erweiterung**: liefert alles, was RPC nicht kann, ueber Erweiterungsbefehle und Dialoge.
- **Rueckfallebene**: xterm.js-Bereich mit dem `Terminal`-Interface von `packages/tui` fuer
  Terminal-Komponenten von Erweiterungen; ANSI-zu-HTML fuer statische Ausgaben.
- **Desktop (Entscheidung Andre, 2026-09-10: Tauri statt Electron)**: Eine Tauri-2-Huelle
  laedt denselben Client und startet den Host als Sidecar auf localhost oder verbindet sich
  mit dem VPS. Sidecars: der Host als mit Bun kompiliertes Binary und Pi als eigenstaendiges
  Binary (Pis `scripts/build-binaries.sh` baut linux/darwin/windows); der Host startet Pi dann
  ueber `--pi-bin` statt ueber Node. Windows-Builds entstehen auf Windows oder in CI, nicht auf
  dem arm64-VPS.

## 5. Tech-Stack

| Schicht | Wahl | Grund |
|---|---|---|
| UI | React 19, TypeScript, Vite | groesstes Oekosystem; Filen und drei der vier Kandidaten; uebernehmbare Bausteine |
| Styling | Tailwind 4, shadcn/ui (Radix), lucide | exakt der Filen-Stack laut DOM; dunkle Design-Tokens zuerst |
| Zustand | Zustand | klein, schnell; percho-Reducer als Vorbild |
| Transkript | TanStack Virtual, rAF-Konflation der Deltas, inkrementelles Markdown | kein Kandidat virtualisiert sauber; agegr parst Markdown je Token neu |
| Code | Shiki, nachgeladen | Qualitaet und Sprachen |
| Host | Node 22, Fastify oder Hono, `ws` | schlank; jmfederico als Vorbild fuer seq/Replay |
| Terminal-Panel | xterm.js, node-pty | wie alle Kandidaten |
| Desktop | Tauri 2 (Rust-Huelle, System-Webview, Sidecars fuer Host und Pi) | Andres Wunsch; kleine Binaries; Client bleibt ohne Desktop-APIs |
| Tests | Vitest, Playwright; Testanbieter ueber `registerProvider` | Laeufe ohne API-Schluessel |
| Zugang VPS | zunaechst SSH-Tunnel oder Tailscale, spaeter Caddy mit Auth | auf dem VPS ist nichts davon installiert; iptables laesst nur 22 und 25565 zu |

Zu uebernehmen (MIT): percho `event-conflator.ts`, `event-slim.ts`, `stream-guard.ts`,
`packages/shared/src/transcript/`; jmfederico seq-Replay und Bounded-WebSocket-Sender;
agegr Extension-UI-Bridge-Idee und Playwright-Fixture-Ansatz; Pi `export-html` Regeln.

## 6. Phasen

Stand 2026-09-10: Phase 0 bis 2 erreicht (Host, Erweiterung, Client, Browsertests gruen), aus
Phase 5 der Sidecar-Nachweis (Tauri-Fenster auf dem VPS unter Xvfb, deb-Paket 96 MB,
Windows-Sidecars cross-kompiliert; der Windows-Installer selbst entsteht auf Windows oder in CI).
Phase 3 und 4 fertig (Mobil-Layout, Freigabedialog, Werkzeuge, Baum, e2e-Suite; Anbieter-
Anmeldung, Konfiguration und Export im Host fertig, Oberflaeche dazu in Arbeit). Der
xterm.js-Bereich laeuft: Pis eigene Terminal-Oberflaeche ist im Browser bedienbar (Statuszeile,
Slash-Befehle, /hotkeys, /quit), damit ist die Rueckfallebene fuer Terminal-Komponenten von
Erweiterungen vorhanden. Grenzen: xterm.js beantwortet Pis Kitty-Tastaturprotokoll nicht, also
sind Tasten, die es zwingend brauchen (etwa Shift+Enter getrennt von Enter), nicht
unterscheidbar; Inline-Bilder im Terminal gibt es nicht. Offen aus Phase 4: Dateibrowser und
Git-Diff. Phase 5 (Desktop) ist als Paket nachgewiesen, Phase 6 (Wechsel auf Pis
Server-Protokoll) wartet auf dessen Stabilisierung.

0. Entscheidung, Repo `/srv/pi-tau` als Monorepo: `packages/host`, `packages/client`,
   `packages/pi-extension`, spaeter `packages/desktop`. Pi 0.85.1 exakt gepinnt.
1. Host: RPC-Kindprozess, WebSocket, Sitzungsliste, Snapshot/Replay, Idle-Timeout.
   Smoke-Test ohne Schluessel.
2. Client-Kern: Chat mit Streaming, Werkzeugkarten, Markdown, Virtualisierung, Composer mit
   Slash-Menue, Modell und Denkstufe, Sitzungen, dunkles Designsystem. Erstes nutzbares
   Ergebnis.
3. Vollstaendigkeit: Erweiterungsdialoge, Status und Widgets, Freigaben, Baum/Fork/Clone,
   Kompaktierung, `!`-Bash, Bilder, Login und Schluessel, Einstellungen, Skills, Prompts,
   Export.
4. Rueckfallebene xterm.js, Terminal-Panel, Dateien und Git-Diff.
5. Desktop: Electron fuer Windows, Auto-Update.
6. Wechsel auf Pis Server-Protokoll, sobald es stabil und veroeffentlicht ist.

## 7. Risiken

- Pi bricht RPC oder SDK in einer Minor-Version: Naht klein halten, Integritaetstest wie
  jmfederico (`piSdkIntegrity.test.ts`), Version nur bewusst anheben.
- Pi hat kein Rechtesystem: Freigabe-Erweiterung von Anfang an; Host nicht als root.
- Performance bei langen Sitzungen: Virtualisierung und Konflation gehoeren in Phase 2, nicht
  in "spaeter".
- Erweiterungen mit Terminal-Komponenten: bewusst erst Phase 4; deklarative Dialoge decken
  den Grossteil ab.

## 8. Offene Entscheidungen

- Entschieden am 2026-09-10: Option B, Tauri, Name **pi-tau** (Oberflaeche: "Tau"), Pi als
  root auf dem VPS, Modell glm-5.3-flash ueber Nebius (Konfiguration siehe README und
  `~/.pi/agent/models.json`; der Schluessel bleibt ausserhalb des Repos in einer Datei, auf die
  `apiKey` per `!cat <pfad>` verweist).
