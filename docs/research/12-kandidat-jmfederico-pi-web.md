<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here are the findings.

## 1. Architecture

**Process model — three processes, not one.** `package.json` declares three binaries: `pi-web` (CLI), `pi-web-server`, `pi-web-sessiond`.

- **`pi-web-sessiond`** (`src/server/sessiond.ts`, 415 lines) is the session owner. It's a Fastify app listening on a **unix socket** (`$PI_WEB_DATA_DIR/sessiond.sock`, default `~/.pi-web/sessiond.sock`) or TCP via `PI_WEB_SESSIOND_PORT/HOST` — see `src/sessiond/config.ts`.
- **`pi-web-server`** (`src/server/app.ts`, 284 lines) is the browser-facing Fastify gateway. It serves the built client via `@fastify/static`, and proxies session HTTP + WebSocket traffic to the daemon through `SessionDaemonClient` (`src/sessiond/sessionDaemonClient.ts`), which does HTTP-over-unix-socket and `ws+unix:<socket>:<path>` WebSockets.
- Vite is dev-only (`vite.config.ts` proxies `/api` and `/pi-web-plugins` to port 8504).

**How pi sessions run: in-process SDK `AgentSession`, inside the daemon.** `src/server/sessions/piSessionService.ts:985-1016` calls `createAgentSessionServices()` then `createAgentSessionFromServices()` and `createAgentSessionRuntime()`. There are **no `pi --mode rpc` child processes** and no use of pi's experimental server/client protocol. The `mode: "rpc"` you'll see at `piSessionService.ts:891` and `:3593` is pi's own `ExtensionUIContext` mode flag (headless vs TUI), not a transport. CHANGELOG 1.202608.1 makes this explicit: *"Always run sessions on the bundled Pi runtime"* — the `agent.command` config key was removed because it never replaced the embedded runtime.

**Surviving browser disconnects** is a consequence of the process split, not of a resume protocol. `AGENTS.md` states the design directly: sessiond runs non-autoreload while the UI/API runs under `tsx watch`, so *"browser disconnects and UI/API restarts should not stop active Pi sessions."* Rejoin is exactly-once: `SessionEventHub.publish()` stamps every per-session frame with a monotonic `seq` (`src/server/realtime/sessionEventHub.ts`), the browser fetches `GET /api/sessions/:id/stream-snapshot` and drops buffered live frames at or below the snapshot watermark (`src/client/src/sessionSocket.ts`, `withTransportSeq`).

**Transport.** Two WebSockets, both JSON text frames, registered in `src/server/sessions/sessionRoutes.ts:481-491`: per-session `/api/sessions/:sessionId/events` and global `/api/events`. Everything else is ordinary REST — roughly 45 session routes in that one file. The event union is `SessionUiEvent` at `src/shared/apiTypes.ts:1307-1333`:

```
message.append | assistant.delta | assistant.thinking.delta
tool.start | tool.update | tool.end
shell.start | shell.chunk | shell.end
agent.start | agent.end | message.end | status.update | activity.update
command.output | session.error | ask.opened/closed | dialog.opened/closed
session.name | session.created | pi.event
```

Reconnect is exponential backoff 500ms → 5s (`sessionSocket.ts`). Frames are validated field-by-field by hand-written parsers in `src/client/src/api/parsers` — an unparseable frame is dropped, not thrown.

**Multi-session / multi-workspace / remote machines.** The model is `Machine → Project → Workspace → Session` (README "Core model"). Workspace discovery is delegated to a server-plugin `WorkspaceProvider`; bundled Git is a *fallback* provider that discovers worktrees (`pi-web-plugins/git/server-plugin.ts`). Remote machines are other full pi-web instances registered in `machines.json`; the gateway proxies projects/files/git/sessions/terminals/plugin assets to them (`src/server/machines/machineProxyRoutes.ts`, `machinePluginProxyRoutes.ts`).

**Auth for remote access: none at the gateway.** README "Security model" is blunt — not a sandbox, not a permission system, not multi-tenant; use VPN/SSH tunnel/authenticated reverse proxy. The only credential in the system is a per-remote-machine bearer token sent gateway→machine (`src/server/machines/machineClient.ts:129`).

**Docker.** `docker/compose.yml` runs sessiond and web as two services on a shared `/data` bind mount, with healthchecks (`test -S /data/pi-web/sessiond.sock`, `curl /api/pi-web/runtime`), openSUSE Tumbleweed base, configurable UID/GID.

**Rendering stack — this is the biggest surprise: Lit, not React.**

| Concern | Choice |
|---|---|
| Components | **Lit 3.3** web components (`lit` dep; ~94 files in `src/client/src/components/`) |
| CSS | Hand-written CSS in `static styles` blocks. **No Tailwind, no component library.** |
| Theming | CSS custom properties, `THEME_TOKENS` in `src/client/src/theme.ts`; default `themes:pi-web-dark`; `color-scheme: dark` hard-set in `src/client/index.html`; light/dark pairs auto-switch; plugins can contribute themes |
| State | Hand-rolled controllers — `src/client/src/appState.ts` + 20 controllers in `src/client/src/controllers/`. No Redux/MobX/signals. |
| Editor | CodeMirror 6 — prompt composer (`components/PromptEditor.ts`) and file/diff viewers (`pi-web-plugins/files/viewerDependencies.ts`, 9 languages + legacy diff mode) |
| Markdown | `marked` 18 |
| Terminal | `@xterm/xterm` 6 + `node-pty` |

## 2. Coupling to pi

**All imports go through the three published barrels** — no deep `dist/**` imports anywhere in shipped code. But the surface is wide.

`@earendil-works/pi-coding-agent` (values, not just types):
- `src/server/sessions/piSessionService.ts:6-29` — `createAgentSessionFromServices`, `createAgentSessionRuntime`, `createAgentSessionServices`, `createEditToolDefinition`, `defineTool`, `hasTrustRequiringProjectResources`, `ProjectTrustStore`, `readStoredCredential`, `SessionManager`, `SettingsManager` + 8 types
- `src/server/sessions/authService.ts:2` — `ModelRuntime`
- `src/server/sessions/globalProviderPolicy.ts`, `sessionModelScope.ts` — `ModelRuntime`, `SessionManager`, `SettingsManager`, `modelsAreEqual`
- `src/server/sessions/attachmentService.ts:4` — `resizeImage`, `formatDimensionNote`
- `src/server/piWebStatus.ts:8`, `piPackageService.ts:1`, `piWebPluginCatalog.ts:6` — `DefaultPackageManager`, `SettingsManager`, `VERSION`
- `src/server/projectTrustRoutes.ts:3` — `ProjectTrustStore`, `SettingsManager`
- `src/server/sessiond/agentHttpDispatcher.ts:2` — `SettingsManager`
- `src/server/sessions/spawnSessionTool.ts`, `spawnSubsessionTool.ts`, `askUserTool.ts` — `defineTool`, `ExtensionContext`

`@earendil-works/pi-ai`: `ImageContent`, `AuthEvent/AuthInteraction/AuthPrompt/AuthType` (`oauthLoginFlowService.ts:2`), `modelsAreEqual` (`sessionModelScope.ts:1`), `Api/AssistantMessage/Model` (`sessionNameGenerator.ts:1`), `InMemoryCredentialStore`, `Credential`, `Provider`.

`@earendil-works/pi-agent-core`: `StreamFn` (`piSessionService.ts:5`), `ThinkingLevel` (`src/shared/thinkingLevels.ts:1`), `runAgentLoop` (tests only).

**Are these "documented SDK APIs"?** Mostly yes, but they're *deep* SDK internals-by-another-name, and pi-web knows it. `src/server/piSdkIntegrity.test.ts` exists solely to assert that 13 named exports still load and are functions, added after `pi-coding-agent@0.85.0` shipped a barrel that statically imported an undeclared package and could not be loaded at all (issue #212). That release is now blacklisted in the peer range: `">=0.84.0 <0.85.0 || >=0.85.1"`.

**Beyond imports, three harder couplings:**

1. **Proxy-wrapping pi's `ExtensionUIContext`** — `piSessionService.ts:3609-3650` returns `new Proxy(baseUiContext, …)` intercepting `notify`, `theme`, `confirm`, `select`, `input` and passing everything else through to pi's headless defaults. Structural dependency on that object's shape.
2. **Byte-level parsing of pi's session JSONL format** — `src/server/sessions/sessionSummaryScanner.ts` classifies lines by matching the raw bytes `{"type":"` at the start of each line, explicitly relying on *"The Pi SDK writes every entry with `type` as the first JSON key."* Plus `sessionFileHeader.ts` reads `type: "session"`, `parentSession`, etc. This is a deliberate perf optimization (avoid decoding huge tool-result bodies) that hard-codes pi's on-disk layout.
3. **Hand-maintained mirror of pi's slash-command list** — `src/server/sessions/builtinCommands.ts` is a static array of 22 commands copied from the TUI. New pi commands don't appear until someone edits this file.

It also reads pi's state files directly: `join(agentDir, "auth.json")` and `models.json` (`src/server/sessions/authService.ts:47-48`), and scans `join(agentDir, "sessions")` for `*.jsonl` (`piSessionManagerGateway.ts:419-433`).

**`pi-packages/` and `extensions/` do NOT bridge UI features:**
- `extensions/pi-web.ts` is a pi *extension* that registers a `/pi-web` command inside the **TUI** for service management (`install`/`status`/`logs`/`restart`). Pure convenience, unrelated to the web UI.
- `pi-packages/relays/` is a pi *package* pi-web publishes (`@jmfederico/pi-relay`) providing a `/relay` prompt, a skill, and a read-only "Relays" browser panel. Auto-installed at daemon start. It's a product feature, not an integration shim.
- `pi-web-plugins/` is pi-web's **own** plugin system (terminal, files, git, updates, workspace-tasks, info) — unrelated to pi extensions.

The important architectural point: **pi-web adds no extensions to pi to make the UI work.** Everything flows through the SDK object graph in-process.

## 3. Feature coverage vs. requirement (d)

| Feature | Status | Evidence |
|---|---|---|
| Slash commands (built-in) | **Partial** | `builtinCommands.ts` lists 22; only `/session /name /compact /reload /clone /fork /tree` run server-side (`sessionCommandService.ts:108-115`). `/login /logout` intercepted client-side (`authController.ts:49`). `/model /settings /new /resume /scoped-models` are UI dialogs/actions. **`/export`, `/import`, `/share`, `/copy`, `/changelog`, `/hotkeys`, `/quit` fall through to `"/${name} is not implemented in the web UI yet"`.** |
| Extension commands | **Yes** | `session.extensionRunner.getRegisteredCommands()` → completion list (`piSessionService.ts:2436`); unknown-but-registered commands forwarded to the agent verbatim (`sessionCommandService.ts:96-104`) |
| Extension dialogs (confirm/select/input) | **Yes, well done** | `piSessionService.ts:3616-3646`; renders as inline transcript cards (`components/ExtensionDialogCard.ts`); works from `tool_call` and `session_start` hooks, survives reload, first-answer-wins across tabs, timeout via `extensionDialogsTimeoutMs`. Documented at `docs/plugins.md` "Pi extension dialogs in PI WEB". |
| Extension widgets / status / editor / `custom` | **No** | `docs/plugins.md`: *"`ExtensionUIContext` methods beyond the three dialogs (widgets, status, editor, `custom`) remain unimplemented under PI WEB even though `hasUI` is `true`."* |
| Model switching | **Yes** | `POST /sessions/:id/model`, `/model/cycle`, `/models/enabled`, `/models/scope`; `components/ModelPicker.ts` with Enabled/All toggle writing pi's `enabledModels` |
| Thinking level | **Yes** | `/thinking-levels`, `/thinking-level`, `/thinking-level/cycle`; shown in assistant bubble metadata |
| Provider login / OAuth | **Yes** | `src/server/sessions/oauthLoginFlowService.ts` (406 lines), `components/AuthDialog.ts`; works for federated remote machines with manual redirect-URL paste |
| API keys | **Yes** | same auth flow, `AuthType` from pi-ai; credential removal step included |
| Sessions list / resume | **Yes** | `sessionSummaryScanner.ts`, `components/SessionList.ts` |
| Branching / forking / tree | **Yes** | `POST /sessions/:id/tree/navigate`, `/tree/fork`; two-step `components/SessionTreeNavigator.ts`; `/clone` duplicates at current position |
| Compaction | **Yes** | `sessionCommandService.ts:170-190`, async with `command.output` result event |
| Skills | **Partial** | listed in command completions (`piSessionService.ts:2442`), invoked by forwarding `/skill:*` to the agent. No skill browser/manager UI. |
| Prompt templates | **Partial** | same — completions only (`piSessionService.ts:2439`) |
| Settings editing | **Yes** | `components/settings/` (28 files) — General, Pi packages, PI WEB plugins, sessiond, Shortcuts; machine-scoped |
| `!` shell commands | **Yes** | `src/client/src/inputModes.ts` — `!` shell, `!!` shell-excluded-from-context, `!@` file-picker; `POST /sessions/:id/shell`; streamed via `shell.start/chunk/end` |
| Image attachments | **Yes** | `src/shared/promptAttachments.ts` (jpeg/png/gif/webp, 4.5MB cap mirroring pi's `DEFAULT_MAX_BYTES`), paste/drop capture, `attachmentService.ts` uses pi's `resizeImage` |
| **Tool approvals** | **No** | Zero grep hits for approval/permission gating. README: *"not a sandbox, permission system."* Only workaround is an extension calling `ctx.ui.confirm()` from a `tool_call` hook (documented pattern). |
| Steer / follow-up queueing | **Yes** | prompt queue with `pendingMessageCount`; `POST /sessions/:id/queue/clear`; `sessionController.sendQueue.test.ts` |
| Abort | **Yes** | `POST /sessions/:id/abort` and `/stop`; `mod+.` shortcut |
| Session export | **No** | `/export`, `/share` unimplemented |
| Terminal | **Yes** | full plugin: xterm + node-pty, PTY replay on reconnect, mobile soft-keys, selection/copy (`pi-web-plugins/terminal/`, 21 files) |
| File browser / editor | **Yes (viewer)** | `pi-web-plugins/files/` — tree, CodeMirror viewer, image/HTML/PDF/Markdown previews, uploads, download. Plugin API exposes `writeFile`/`deleteFile`/`moveFile`, but the bundled panel is read-oriented. |
| Git | **Yes** | `pi-web-plugins/git/` — worktree discovery, status, unified diff with grapheme-level inline highlights, worktree removal plans |
| Extras beyond TUI | project trust toggle, unread/notification inbox, session archive + bulk cleanup, `ask_user` forms, tracked subsessions (`spawn_subsession`/`list`/`check`/`read`/`yield`), workspace tasks, remote machine fleet, PWA |

## 4. Plugin API

Two separate, versioned, genuinely well-designed contracts. Read `src/plugin-api.ts` (browser, `apiVersion: 2`) and `src/server-plugin-api.ts` (server, `apiVersion: 1`); reference docs in `docs/plugins.md` (1613 lines).

**Browser plugin can contribute** (`PluginContributions`): `actions` (action-palette entries with keyboard shortcuts), `workspacePanels` (tabs next to Files/Terminal, with `icon`, `badge`, `visible`, `onInvalidate`, and contribution-scoped URL state via `WorkspacePanelNavigationV1`), `workspaceLabels` (compact status chips), `themes` and `themePairs`.

**It gets**: a Lit `html`/`svg` tag, a `PluginRuntimeContext` (open palette, focus/insert into prompt, switch view/panel, open terminal, start/archive session, stop work, refresh), `WorkspaceFilesCapabilityV1` (read/list/write/delete/move + `previewUrl`/`downloadUrl`/`uploadFile` with progress), `WorkspacePanelTerminal.runCommand()`, and `PairedWorkspaceBackendV1` — a bounded JSON request channel plus a duplex WebSocket channel to its **own** server module, revision-paired so a mismatched front/back end is withheld rather than run.

**Server plugin can contribute**: a `WorkspaceProvider` (probe/claim/list/request/prepareRemove), a `PairedPluginBackendV1`, `start`/`stop`/`health` lifecycle, plus a host `execFile` with output/time bounds, a scoped logger, and a `notices` reporter that surfaces messages in the browser scoped to project/workspace/session.

**Is it a good extension point for your features? Only for the surfaces it names.** Quoting `docs/plugins.md`: *"Plugins do not get raw Fastify access, arbitrary routes, concrete core services, a generic event bus, Pi model-provider registration, or a general server-hook API."*

Concretely, **there is no chat/session extension point**. `PluginRuntimeState.selectedSession` is typed `unknown` (`src/plugin-api.ts`). You cannot render a custom message type in the transcript, add a tool-result renderer, intercept prompts, add a slash command, or hook the agent loop. Compare the public `PluginRuntimeContext` in `src/plugin-api.ts` with the internal one at `src/client/src/plugins/types.ts:210-242`: the internal version has `openModelPicker`, `openThinkingLevelPicker`, `addMachine`, `deleteWorkspace`, `reloadSession`, and `piWebUnstable.openSettings` — all withheld from third parties. The Terminal plugin's `requiredTerminalFacade`/`requiredTerminalService` are explicitly flagged as *"privileged host-only composition ports … not third-party plugin APIs."*

So: side panels, tools, badges, themes, and workspace semantics → plugin API, no fork. Anything touching the chat transcript, prompt pipeline, or session lifecycle → fork or upstream PR.

The contract discipline is impressive, though: `src/plugin-api.test.ts` uses `expectTypeOf` to assert readonly-ness and exact shapes against a frozen baseline in `test-fixtures/plugin-api-baseline/`, and `scripts/plugin-api-package-smoke.mjs` verifies the published `.d.ts` compiles standalone for external strict-TS consumers.

## 5. Desktop suitability

**No existing desktop code.** Zero matches for `electron|tauri|webview|neutralino` across the repo.

**What helps:**
- `vite.config.ts` sets `base: "./"` — fully relative asset paths.
- The Fastify gateway already serves the built client (`app.ts`, `fastifyStatic` + SPA `setNotFoundHandler`), so an Electron/Tauri main process can spawn `pi-web-server` + `pi-web-sessiond` as sidecars and point a `BrowserWindow` at `http://127.0.0.1:8504`. That path works today, unmodified.
- Config is env-driven (`PI_WEB_DATA_DIR`, `PI_WEB_PORT`, `PI_WEB_SESSIOND_SOCKET`), so a desktop app can isolate its own state dir.
- CI already runs the full suite on `windows-latest` (`.github/workflows/ci.yml` matrix), and there's Windows path handling throughout (`src/config.ts:514`, `piWebPluginCatalog.ts:755`, `workingDirectory.ts:42`).
- No service worker — nothing to fight during packaging.

**What blocks or complicates it:**
- **`file://` is a non-starter.** `resolveAppWebSocketUrl()` (`src/client/src/appUrl.ts:18-28`) throws `Cannot create a WebSocket URL from ${protocol}` for anything but `http:`/`https:`. You must use the loopback-HTTP sidecar approach (which is fine, and arguably better anyway).
- **`node-pty` is a native module.** Requires `electron-rebuild` / correct ABI per Electron version, and the install docs already warn about it (`npm install -g … --allow-scripts=node-pty`, plus a dedicated FAQ entry "node-pty native module is missing").
- **Service installation is systemd/launchd only.** `src/nativeServices/` has `systemdName`/`launchdTarget` throughout, no Windows Service or Scheduled Task backend. For a desktop app you'd bypass this entirely and supervise the two child processes from the main process — meaning `src/nativeServices/` (14 files), `src/cli.ts`, `src/docker/`, and the Updates plugin become dead weight you'd carry or strip.
- **FAQ, on Windows:** *"Native Windows: outside WSL is not the recommended path today."* Tests pass on Windows; the *product* isn't validated there. Pi itself, node-pty PTYs, and login-shell command execution are the risk areas.
- The Lit + custom-CSS client is not going to be trivially restyled if you want a different visual direction — there's no design-system layer to swap.

## 6. Quality

**Very high.** This is a seriously engineered codebase, not a weekend project.

- **Size:** ~172k lines of TS/mjs. `src/server/sessions/` alone is 32.6k lines; `piSessionService.ts` is **4,923 lines** (the main complexity hotspot). `PiWebApp.ts` is 2,920 lines.
- **Tests:** **370 test files**, vitest 4 + happy-dom, colocated `*.test.ts`. Includes type-level contract tests (`src/plugin-api.test.ts`), package-integrity tests against upstream pi (`src/server/piSdkIntegrity.test.ts`), integration tests (`pluginBackendChannel.integration.test.ts`), acceptance tests, and shared harnesses (`*.testSupport.ts`). Fixtures in `test-fixtures/plugin-api-baseline/` freeze the published `.d.ts` surface.
- **TypeScript:** maximally strict — `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false` (`tsconfig.json`).
- **CI:** `.github/workflows/ci.yml` — Linux + Windows matrix, `npm run verify` (typecheck + eslint + **knip** dead-code detection + tests), then build, global-install smoke test, and `npm pack --dry-run` content check. Pre-commit hook via `scripts/verify-staged.mjs`.
- **Docs:** exceptional. 1613-line plugin reference, 470-line config reference, a docs site on Cloudflare Workers, plus `.agents/skills/` containing five internal skill files (testing-guide, documentation-guide, code-quality-architecture, changeset-changelog, npm-release) that the author uses to drive his own agent work.
- **Release cadence:** changesets-driven, CalVer `1.YYYYMM.N`. **27 releases** from `1.202605.x` to `1.202609.0` — roughly one every 4–5 days, matching pi's own cadence. CHANGELOG entries are unusually detailed and honestly flag regressions and costs.
- **Pinning pi:** devDependency `^0.85.1`; **peerDependency `>=0.84.0 <0.85.0 || >=0.85.1`** — an *open upper bound*. New pi majors are auto-accepted by npm's peer resolution, with `piSdkIntegrity.test.ts` as the only tripwire (and it only runs in *their* CI, not on your machine).

**Weak spots:** `piSessionService.ts` at ~5k lines is a god-object; no e2e/browser test layer (there's `scripts/capture-screenshots.mjs` but it's for docs); federation is explicitly all-or-nothing across versions, which the CHANGELOG documents as a repeated source of breakage.

## 7. Performance-relevant choices

- **No virtualization of the transcript.** The only `content-visibility: auto` in the codebase is one row style in `SessionTreeNavigator.ts:546`. Instead: **server-side paging** at 100 messages/page, max 500 (`src/server/sessions/messagePaging.ts`), expanded backward to a user-message turn boundary so a page never splits a turn, with scroll-up infinite loading (`src/client/src/chatHistoryLoading.ts`) plus scroll anchoring and position restore (`chatScrollAnchoring.ts`, `chatScrollPosition.ts`). Fine for normal sessions; a 5,000-message session held in DOM will get heavy.
- **Streaming is per-token deltas, unbatched** (`assistant.delta`, `assistant.thinking.delta`) — Lit's `render` batching absorbs it, but there's no explicit coalescing layer.
- **Bounded WebSocket senders** with explicit frame/byte queue caps and drain semantics (`src/server/webSocketBridge.ts`, `createBoundedTextWebSocketSender`) — overflow closes the channel rather than ballooning memory.
- **Session-list scanning is heavily optimized**: byte-prefix line classification without decoding, JSON-parsing only the header, `session_info` lines, and messages up to the first user text (`sessionSummaryScanner.ts`); append-only tail reads when a file grows; throttled path resolution; LRU-bounded idle transcript cache (all added in 1.202609.0).
- **Build splitting**: `vite.config.ts` `manualChunks` isolates CodeMirror core / languages / legacy-modes and xterm into separate vendor chunks; plugin modules load lazily by content-revision URL.
- `@fastify/compress` global compression above 1KB.

---

## Verdict

**Strengths:** Genuinely production-grade — 370 test files, max-strict TS, Linux+Windows CI, superb docs, and a mature versioned plugin API with paired browser/server backends; the sessiond/web split gives you real session persistence across disconnects and UI restarts for free, and coverage of pi's surface (models, auth+OAuth, thinking, tree/fork/clone, compaction, extension dialogs, `!` shell, images, terminals, git, remote machine fleet) is far deeper than any greenfield effort would reach in months.

**Weaknesses:** Lit + hand-written CSS with no design system (a "modern dark responsive UI" is already there and is decent, but redesigning it means touching ~94 component files); **no tool-approval/permission layer at all**; `/export`, `/import`, `/share`, `/copy` unimplemented and skills/prompt-templates are completion-only; extension *widgets*/status/editor/`custom` surfaces are explicit no-ops; the plugin API deliberately excludes the chat transcript, prompt pipeline, and session lifecycle, so your own chat-level features mean forking; and `piSessionService.ts` at 4,923 lines is where you'd have to live.

**(i) Adapting to a Windows desktop app — moderate, maybe 1–2 weeks for a working prototype.** The architecture cooperates: `base: "./"`, the gateway already serves the built client, config is env-driven, so Electron/Tauri spawning `pi-web-sessiond` + `pi-web-server` as sidecars and loading `http://127.0.0.1:8504` works essentially as-is. Real costs are `node-pty` ABI rebuilds per Electron version, `file://` being impossible (`appUrl.ts:18` throws on non-http), replacing the systemd/launchd-only `src/nativeServices/` with your own supervision, and the fact that native Windows is explicitly not a recommended path today — so expect to be the one who finds the PATH/login-shell/PTY bugs.

**(ii) Staying in sync with upstream pi — this is the real risk, and it cuts against your requirement (c).** Coupling is *not* minimal: it consumes ~25 SDK value exports including session-construction internals, `Proxy`-wraps `ExtensionUIContext`, parses pi's JSONL transcript at the byte level assuming `type` is the first key, reads `auth.json`/`models.json` directly, and hand-mirrors pi's slash-command list. The peer range has no upper bound, and the recent history is instructive — pi 0.84 forced breaking config changes, pi 0.85.0 broke pi-web outright. The mitigation is that **jmfederico is absorbing that maintenance at roughly your own cadence (27 releases in ~4 months)**, and that is worth far more than the coupling costs you. Build on it, contribute upstream, and keep your additions inside the plugin API wherever they'll fit — but budget for the fact that if this project stops, you inherit a 172k-line codebase whose tie to pi is deep rather than shallow.
