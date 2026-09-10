<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here are my findings.

---

# percho (Jaxton07/percho) — evaluation

Repo: `<scratch>/gui-repos/Jaxton07__percho` (shallow clone, 1 squashed commit, HEAD 2026-09-09). ~34.6k LOC source + 12.8k LOC tests. Single maintainer, repo created 2026-08-08, 303 stars, 36 releases, ~7.5k total downloads.

---

## 1. Architecture

**Workspaces** (`package.json` → `workspaces: ["packages/*"]`, npm workspaces, no turbo/nx):

| Package | LOC | Role |
|---|---|---|
| `packages/shared` | 3.2k | Pure types + channel-name constants + **the UI transcript state machine** (`src/transcript/`: reducer, chat-rows, turn-timings, turn-files, parse-patch, meta-summary). Shared by desktop renderer *and* the LAN web app. |
| `packages/backend` | 10.3k | Pure Node, **zero Electron imports**. pi SDK adapter + a large amount of home-grown agent machinery (permissions engine, subagents, todo tool, webfetch, "context evaporation", channel-watch, LAN HTTP server). |
| `packages/desktop` | 21.4k | Electron main (2.7k incl. preload) + React renderer (18.7k) + a separate `src/lan-web` browser app (2.4k). |

**Process model** — pi runs **in the Electron main process, in-process, via the SDK**. `packages/desktop/src/main/index.ts:181` does `backend = new PiBackend({...}); await backend.init()`. No utility process, no child `pi` process, no CLI shelling. `child_process` is used only for git (`main/git.ts`), PATH repair (`main/fix-path.ts`), the updater, and npm package installs. Consequence: a runaway model stream can take down the whole app — which is exactly what `docs/PITFALLS.md` documents (a 12.7 GB-in-3-minutes trace explosion, two white-screen incidents), and why `main/index.ts` has a renderer crash-loop auto-reload and an incident-snapshot logger.

**IPC design — this is the standout.** The renderer is a **pure web app talking a promise-RPC + event-subscription protocol**. Contract in `packages/shared/src/ipc.ts` (349 lines): `IpcChannels` (≈110 channel constants) + `interface PiApi` (≈110 methods + 6 `on*` subscriptions + one sync `platform` field). `packages/desktop/src/preload/index.ts` is a purely mechanical 1:1 map — every method is `ipcRenderer.invoke(channel, ...args)`, every subscription is `ipcRenderer.on` + a disposer — then `contextBridge.exposeInMainWorld("pi", api)`. The renderer accesses it only through `getPi()` in `packages/desktop/src/renderer/src/api.ts`. **Zero `import ... from "electron"` in the entire renderer tree.** Main-side handlers (`packages/desktop/src/main/ipc/{sessions,settings,packages,app,ui-plugins,lan}.ts`, 408 lines total) are thin delegations to `PiBackend`. `pi-backend.ts:139` even states the intent: "主进程与（未来的）独立 server 均可复用" — reusable by the main process *and a future standalone server*.

**Rendering stack**: React 19.2.8 + react-dom, Tailwind 4.3.3 (`@tailwindcss/vite`), Zustand 5.0.14, Vite 7 via `electron-vite` 5. Markdown = `markstream-react@0.0.55` (incremental streaming parser) with `stream-monaco` + `monaco-editor@0.55` for code blocks (shiki `vitesse-light/dark`) — see `renderer/src/components/chat/Markdown.tsx`. Drag/drop = `@dnd-kit/*` (session tab reordering). Animation = `thinking-orbs` + hand-written canvas (`chat/center-orb-draw.ts`). Icons are hand-inlined SVG (`components/icons/index.tsx`, 640 lines) — **no component library** (no shadcn/radix/MUI); `components/ui/` is a hand-rolled Button/Dropdown/Switch/Tooltip.

**State**: Zustand, ~12 stores (`renderer/src/stores/`: sessions, transcript, drafts, settings, theme, ui, ui-preferences, projects, catalog, provider-login, ui-plugins, toasts, update). Transcript state is a shared reducer in `packages/shared/src/transcript/reducer.ts` (576 lines) driven by pi events.

**Theming**: CSS custom properties in `renderer/src/styles/globals.css` (1766 lines) — semantic tokens (`--color-canvas/surface/ink/ink-dim/accent/err/warn`, three shadow tiers) redefined under `[data-theme="dark"]`, wired into Tailwind via `@theme inline` + `@custom-variant dark (&:where([data-theme="dark"] ...))`. Light/dark/system, plus a custom background image with adjustable dim. Theme is written to `data-theme` before first paint (`bootstrap-theme.ts` reads a `?theme=` query param injected by `main/window.ts`) to avoid flash. Dark mode is genuinely first-class, not an afterthought.

---

## 2. Coupling to pi

**No experimental paths.** Grep for `experimental/plugin`, `pi-protocol`, `pi-client`, `pi-tui`, `pi-agent-core` across `packages/` and `scripts/` returns **zero hits**. Only `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai`.

**But the "one file imports pi" rule in CONTRIBUTING.md is false.** 20 backend source files import pi. Runtime (value) imports:

- `packages/backend/src/pi-backend.ts:6-14` — `createAgentSession`, `getAgentDir`, `ModelRuntime`, `ProjectTrustStore`, `SessionManager`; `pi-backend.ts:5` — `getSupportedThinkingLevels` from pi-ai
- `packages/backend/src/session/ui-context.ts:2` — `Theme` **class instantiated** with ~40 required color fields (`ui-context.ts:20-75`); the file's own comment says "SDK 接口变化时在这里补齐新成员" (add new members here when the SDK changes)
- `packages/backend/src/settings/settings.ts:2` — `builtinProviders` from **`@earendil-works/pi-ai/providers/all`** (a deep subpath, not the package root — highest breakage risk)
- `packages/backend/src/project/trust-loader.ts:2` — `DefaultResourceLoader`, `getAgentDir`, `SettingsManager`
- `packages/backend/src/project/trust.ts:3-8` — `hasTrustRequiringProjectResources`
- `packages/backend/src/packages/admin.ts:1` — `DefaultPackageManager`, `SettingsManager`
- `packages/backend/src/session/messages.ts:1-6` — `parseSessionEntries`
- `packages/backend/src/tools/subagent/runner.ts:5-11` — `createAgentSession`, `DefaultResourceLoader`, `SessionManager`, `SettingsManager`, `getAgentDir`
- `packages/backend/src/tools/subagent/agents.ts:4` — `getAgentDir`

Type-only imports pull in `InlineExtension`, `ExtensionContext`, `ExtensionUIContext`, `ToolDefinition`, `AgentToolResult`, `AgentSession`, `AgentSessionEvent`, `ModelRuntime`, `SessionEntry`, `LoadExtensionsResult`, `ProjectTrustStore` across `permissions/extension.ts`, `tools/*/`, `session/*`, `slash-commands.ts`.

**Three deeper coupling hazards:**

1. **Internal state mutation.** `packages/backend/src/pi-backend.ts:833`:
   ```ts
   entry.session.agent.state.messages = sm.buildSessionContext().messages;
   ```
   That is reaching through `session.agent.state` to rebuild the LLM context by hand (the dangling-user-message recall path). Any refactor of pi's agent state breaks this silently.

2. **The renderer's wire format *is* pi's event union.** `packages/shared/src/session.ts:355`: `export type SessionEvent = PiAgentSessionEvent | SubagentMutexEvent | StreamGuardTrippedEvent`. Events are forwarded raw (after slimming) all the way into `shared/src/transcript/reducer.ts`, which `switch`es on 22 pi event types. There is an anti-corruption layer for *history* (`session/messages.ts` maps pi messages → a neutral `SessionMessage`) but **none for the live event stream**. TypeScript will catch shape changes at build time, but the reducer logic must be updated by hand.

3. **Percho re-implements a lot of what pi does**, on pi's extension hooks: a full per-tool permission engine (`permissions/` — 8 files, glob patterns, bash-chain "strictest segment" analysis, temp-zone exemptions, multi-root workspace boundaries, fullAccess audit log) built on the `tool_call` hook; an in-process subagent runner (`tools/subagent/`); a todo tool; a webfetch tool with SSRF guard; "context evaporation" (`tools/context-evaporation/`, 830-line `evaporate.ts`, on by default); a cross-session channel-watch extension. This is ~10k LOC of backend that must track pi's extension-hook semantics — *more* upstream surface than a thin GUI, not less.

**Version pinning**: exact, no caret — `"@earendil-works/pi-coding-agent": "0.84.3"` and `"@earendil-works/pi-ai": "0.84.3"` in all three package.jsons. Plus `external: ["@earendil-works/pi-coding-agent"]` in `packages/desktop/electron.vite.config.ts:11`, and `packages/desktop/electron-builder.yml` copies **8 specific paths out of the pi package** into `extraResources`, including deep dist paths `dist/core/export-html`, `dist/modes/interactive/theme`, `dist/modes/interactive/assets` — these will break on any pi internal reorg, and `main/pi-package-dir.ts` sets `PI_PACKAGE_DIR` to point at them.

**Current lag**: pinned 0.84.3 (published 2026-08-24). Latest on npm is **0.85.1** (2026-09-05). Three releases behind (0.84.4, 0.85.0, 0.85.1) despite a commit today. pi's actual cadence from npm `time`: 0.80.3 → 0.85.1 is 20 releases in 67 days ≈ one every 3.4 days — your estimate is right.

**`patches/` — not a red flag.** Exactly one file: `patches/thinking-orbs+0.3.1.patch` (6.9 KB), applied by `patch-package` from the root `postinstall`. It patches `node_modules/thinking-orbs/dist/index.cjs` and `index.es.js` — a small canvas animation library, **not a pi package**. The patch strips the `IntersectionObserver` + `visibilitychange` gating around the `requestAnimationFrame` loop, because on Windows 11 a lost resume event left the animation permanently frozen. `docs/INDEX.md:44` documents the re-patching procedure. Low risk, unrelated to upstream pi.

---

## 3. Feature coverage vs. requirement (d)

| Capability | Status | Where |
|---|---|---|
| Slash commands | ✅ | `backend/src/slash-commands.ts` (4 builtins: compact/name/export/settings) + `composer/SlashMenu.tsx`, `use-slash-menu.ts`. Builtins intercepted in `use-composer-send.ts:runSlashCommand`; everything else passed through as raw text for SDK-native expansion. pi's other TUI commands (`/model`, `/resume`, …) are deliberately omitted in favour of GUI equivalents. |
| Prompt templates | ✅ | `slash-commands.ts:templateCommands` via `loader.getPrompts()`; expanded natively by the SDK. |
| Skill invocation | ✅ | `/skill:<name>` — `slash-commands.ts:skillCommands`; display projection in `shared/src/skill-invocation.ts`. |
| Skills management | ⚠️ read-only | `settings/SkillsPanel.tsx` lists loaded skills + scope badge + diagnostics. No enable/disable/author/edit. |
| Extension commands | ✅ | `session.extensionRunner.getRegisteredCommands()`, with pi's `:N` duplicate-suffix rule re-implemented in `slash-commands.ts:extensionCommands`. |
| **Extension-provided UI dialogs** | ❌ **stubbed out** | `backend/src/session/ui-context.ts:81-110`: `select → undefined`, `input → undefined`, `custom → undefined`, `editor → undefined`; `setWidget/setFooter/setHeader/setStatus/setWorkingMessage/addAutocompleteProvider/setEditorComponent` are all no-ops. Only `confirm` is bridged (to the permission gate). Documented as deliberate ("D8"). **Any extension that asks the user to pick from a list silently receives "cancelled".** |
| **Custom extension messages** | ❌ | `shared/src/transcript/reducer.ts` has no `custom` case; the backend only reads `customType` for its own todo-reminder. Extension-emitted custom messages are not rendered. |
| Model switching | ✅ | `composer/ModelPicker.tsx` → `session.setModel`; plus per-model hide (`settings/model-prefs.ts`) and per-subagent model override. |
| Thinking level | ✅ | `composer/ThinkingPicker.tsx`, filtered by `getSupportedThinkingLevels(model)`, clamped in `lib/thinking.ts`. |
| Provider login / OAuth | ✅ | `backend/src/settings/login.ts` bridges pi's `AuthInteraction` to IPC events; `settings/providers/LoginDialog.tsx` handles device code, auth URL, prompts, selects. Also interactive api_key flows (Google Vertex ADC), with `filterAuthSelectOptions` removing the always-failing api-key option for Vertex. |
| API keys / custom providers | ✅ | `settings/settings.ts` — save/remove key, add/update/remove custom provider, base-URL override for builtins, `testProvider`. Keys stored as `$ENV_VAR` references, never plaintext. |
| Sessions list / resume | ✅ | per-cwd + `listAllSessions()`; tabs persisted to `userData/tabs.json`, dnd-kit reordering, optional left rail, draft (`draft:`-prefixed) tabs. |
| Fork / branch | ✅ | `pi-backend.ts:781 forkSession` → `SessionManager.createBranchedSession`; per-message Fork button. Refused while streaming/compacting. |
| Recall (undo a user message) | ✅ | `pi-backend.ts:810` → `navigateTree` + a persisted `message-recalled` custom entry so the leaf move survives restart. |
| **Session tree view** | ❌ | No branch/tree browser UI. Fork & recall are per-message buttons only. |
| Compaction | ✅ | `/compact [focus]`, `compaction_start/end` → divider in `chat/SystemMessage.tsx`, composer blocked during compaction. Plus home-grown "context evaporation" (default on). |
| Settings editing | ⚠️ partial | Panels: general, appearance (+UI plugins), models/providers, skills, **mcp = placeholder** (`McpPanel.tsx`), extensions, LAN, about. Permission rules (`permissions.json`) and workspace roots (`workspaces.json`) have **no UI** — `docs/INDEX.md:213` says edit by hand. |
| **`!` shell commands** | ❌ | No bash mode anywhere in the composer. (`bashMode` appears only as a color in the pi `Theme` instance.) |
| Image attachments | ✅ | `composer/Composer.tsx` — file picker + Ctrl+V paste → base64 `ImageInput`; gated on `model.input.includes("image")` (fail-open); `ImageTray`, full-screen `ImagePreview`, history thumbnails. Plus an agent-initiated `show_image` tool (`backend/src/tools/show-image.ts`, 1–9 images, kept out of model context via `details`). |
| **Visual tool approvals** | ✅ **home-grown, not pi's** | An `InlineExtension` on the `tool_call` hook (`permissions/extension.ts`) + a `PermissionGate` queue (`permissions/gate.ts`) + `session/ApprovalDock.tsx` (Enter/A/D/Esc shortcuts, `await` before card removal). Answers: allow / deny / allowAlways / allowDir. Evaluation chain: deny-list → temp zone → multi-root read/write boundary → project memory (`workspaces.json` `allowed[]`) → ask. Bash command chains evaluated at the strictest segment (`permissions/bash-chain.ts`). Per-session `fullAccess` mode downgrades to audit-and-allow with a JSONL audit log. Injected via `session.bindExtensions({ uiContext, mode: "tui" })`. Known gaps documented: `xargs`, `find -exec`, `python -c` not covered. |
| Follow-up queueing | ✅ | `streamingBehavior: "followUp"`, `QueueBar` with undo-into-composer. **Cap is 1 queued non-slash message** (`use-composer-send.ts`). |
| **Steer (mid-run interrupt)** | ❌ | `pi-backend.ts:517`: "steer 打断暂不支持" — steering is explicitly not implemented. |
| Abort | ✅ | `handleStop` clears the queue (restoring text to the composer) then aborts. |
| Subagents | ✅ home-grown | `tools/subagent/` — `{agent,task}` single + `{tasks[]}` parallel (cap 8, concurrency 4); builtin `scout` + `~/.pi/agent/agents/` + `.pi/agents/` (trusted only); a mutex that shadows third-party subagent extensions and emits a `subagent_mutex` UI event; sub-sessions land in `sessions-subagents/` and open read-only; `chat/SubagentRunCard.tsx` is clickable. |
| Session export | ✅ | `session.exportToHtml()` / `exportToJsonl()` → native save dialog. |
| **Terminal** | ❌ | No xterm, no terminal anywhere. |
| **File browser / editor** | ❌ | Only `@`-completion (`project/files.ts`, 5000-file walk, 30 s TTL) and a per-turn unified-diff sidebar (`diff/DiffSidebar.tsx`). |
| Git | ⚠️ minimal | `main/git.ts` — current branch, list branches, checkout. Surfaced in `ProjectBranchPicker.tsx` (draft sessions only) and a `BranchRow` in the diff sidebar. No stage/commit/push. |

**Extras beyond the pi TUI**: UI-plugin system (esbuild-built TSX plugins sharing the host React instance, 3 replaceable slots + 7 mount regions + headless plugins, hot reload, trust gate — `resources/ui-plugins/SPEC.md`), desk pets, custom backgrounds, LAN observer + remote control, channel-watch cross-session messaging, todo panel, per-turn timing + file-change chips, unified error cards with retry, selection-to-quote.

---

## 4. Web suitability

**Better than almost any Electron GUI you'll find, but not free.**

What's already right:
- Renderer has **zero Electron imports**. 125 call sites, all through `getPi()`.
- The preload is a mechanical 1:1 translation of `PiApi` (`packages/desktop/src/preload/index.ts`, ~180 lines). Replacing it with a WebSocket/HTTP client is a rewrite of that one file plus a server that mounts `PiBackend`.
- `packages/backend` is Electron-free by design and already documented as server-reusable (`pi-backend.ts:139`).
- The renderer bundle is a plain Vite build already served over HTTP in dev (`main/window.ts:73-78` uses `ELECTRON_RENDERER_URL` in dev, `loadFile` in prod).
- **The pattern is already proven in-repo**: `packages/backend/src/lan/server.ts` (690 lines) is a real HTTP+SSE server — snapshot, event stream, per-session transcript, and three write endpoints (`POST /api/sessions/:id/prompt`, `/abort`, `/api/permissions/:id/respond`) — with bearer-token auth (`timingSafeEqual`), delta micro-batching, seq-based dedup, backpressure queueing, heartbeat/watchdog, and an audit log. `packages/desktop/src/lan-web/` is a real browser client that **shares `packages/shared/src/transcript/` with the desktop renderer**.

What blocks it:
- **The LAN web app is a *second, thinner UI*, not the same codebase.** ~2.4k LOC vs the desktop renderer's 18.7k. It has prompt/abort/approve/list/transcript and nothing else — no model switching, no settings, no slash menu, no images (base64 is stripped, `LAN_IMAGE_PLACEHOLDER`), no fork/recall, no session creation. So **requirement (a) is not met today**: there are two UIs, and only one of them is the good one.
- Renderer bits needing web equivalents: `getPi().platform` (`SessionTabBar.tsx:195` — frameless-window chrome per platform), and `pi-bg://background/<name>` custom-protocol URLs (`stores/theme.ts:11`).
- Main-side capabilities with no browser analogue, all exposed as RPC and therefore all needing redesign: `pickDirectory`, `saveFileDialog`, `pickBackgroundImage` (native dialogs), `openExternal`, `uiPluginsOpenDir` (`shell.openPath`), the auto-updater channels, tabs/ui-state in `app.getPath('userData')`, the UI-plugin esbuild build (spawns a platform binary — `main/ui-plugins/build.ts`), and the OAuth flow (currently "open the system browser").
- **No multi-user story at all.** The LAN server is one shared bearer token, 5-client cap, binds `0.0.0.0`, prompt body capped at 8 KB, remote permission answers restricted to allowOnce/deny. That is a phone-on-your-couch design, not a VPS-auth design. You'd add TLS, real sessions/auth, and per-user isolation yourself.
- Windows-frameless chrome (`main/window.ts` — `titleBarOverlay`, drag regions) needs a browser fallback.

Rough effort to add a proper browser/remote mode for the *full* renderer: replace preload with a transport client (~1–2 days), stand up an HTTP/WS server over `PiBackend` (~2–4 days, much of it copyable from `lan/server.ts`), then work through the ~10 native-capability RPCs and auth (~1–2 weeks). Call it **2–4 weeks** to something you'd expose on a VPS. That is genuinely low for an Electron app — the boundary discipline here is the real asset.

---

## 5. Quality

- **Tests**: 83 test files, ~12.8k LOC, vitest. Backend has 50 (permissions, subagents, evaporation, LAN server/projector/sanitize, trace, stream-guard, fork/recall, settings, login, webfetch, trust). Renderer has ~25, all pure-logic (reducer, chat-rows, turn-timings, conflator, stores) — **no component/DOM tests**, no e2e. Real-SDK verification is via manual smoke scripts in `scripts/` (`smoke-backend.mts` needs `AI_OPS_API_KEY`), not CI.
- **CI** (`.github/workflows/ci.yml`): ubuntu-only, `npm ci` → `lint` (biome) → `typecheck` → `test` → `build`. Clean and fast, but **the Windows and macOS builds are only exercised at release time**.
- **TypeScript**: `tsconfig.base.json` — `strict: true`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `isolatedModules`, `forceConsistentCasingInFileNames`. Two caveats: biome disables `noExplicitAny` (`biome.json`), and `packages/backend/tsconfig.json` has `include: ["src"]` — **the 50 backend test files are never typechecked**.
- **Code size**: renderer 18.7k / backend 10.3k / shared 3.2k / main+preload 2.7k / lan-web 2.4k. Largest files: `pi-backend.ts` 1091, `context-evaporation/evaporate.ts` 830, `lan/server.ts` 690, `shared/transcript/reducer.ts` 576. Reasonable decomposition; nothing pathological.
- **Release cadence**: 36 releases 2026-08-08 → 2026-09-06 (~1 per day early, settling to ~every 3–4 days). Downloads are concentrated in the last four: v0.5.6 1540, v0.5.5 1440, v0.5.4 1627, v0.5.3 722; **7518 total**. Real but small user base; single maintainer, 5 open issues.
- **Windows build** (`packages/desktop/electron-builder.yml`): electron-builder 26, targets `nsis` + `zip` x64, `artifactName: percho-windows-${arch}.${ext}`, `nsis.oneClick: false` with install-dir choice. **No code signing** — the release workflow sets `CSC_IDENTITY_AUTO_DISCOVERY: "false"` and mac uses ad-hoc `identity: "-"` with `hardenedRuntime: false`. README documents the SmartScreen "More info → Run anyway" dance and macOS Gatekeeper workarounds. Auto-update via `electron-updater` with the GitHub provider; on macOS the ad-hoc build can't self-install so it opens the Releases page.
- **Docs**: `docs/INDEX.md` (43 KB) and `docs/PITFALLS.md` (16 KB) are unusually good — a genuine navigation index plus an incident post-mortem log. **Both are entirely in Chinese, as are essentially all code comments.** The UI itself is bilingual (`i18n/en.ts` 505 lines, `i18n/zh.ts` 493, auto-selected from `navigator.language`). If you fork this, you inherit a Chinese-language codebase.

---

## 6. Performance-relevant choices

- **No virtualization anywhere.** No `react-window` / `react-virtual` / `virtua` / `@tanstack/react-virtual` in any package.json. `chat/MessageList.tsx` renders every row; it memoizes the row model (`buildChatRows` in `useMemo`) and uses a `ResizeObserver` for bottom-following with a 48px threshold. Long sessions will degrade — partially mitigated by grouping tool calls into collapsed `MetaGroup`s.
- **Streaming is batched at four layers**, and this is the most impressive engineering in the repo:
  1. `backend/src/session/event-slim.ts` — strips the full accumulated snapshot that pi attaches to every `message_update` delta, strips image base64, truncates oversized text. Single choke point in `pi-backend.ts:emitEvent`.
  2. `backend/src/session/stream-guard.ts` — circuit breaker: >8 KB of consecutive whitespace or a >2 MB message aborts the session and discards subsequent deltas, synthesizing a `stream_guard_tripped` UI event.
  3. `renderer/src/stores/event-conflator.ts` — rAF-driven conflation: append-only deltas (`text_delta`/`thinking_delta`/`toolcall_delta` keyed by `(session, type, contentIndex)`, string `tool_execution_update`) concatenate in place; boundary/control events flush pending deltas first, preserving order exactly. Falls back to a 250 ms timer when the window is hidden. Has unit tests with an injectable scheduler.
  4. `backend/src/lan/server.ts` — 50 ms delta micro-batching per session, 120 ms dirty-view flush, per-client write queue with backpressure and a 256-frame drop threshold.
  Plus `markstream-react` grapheme-level smooth streaming (80 cps floor, adaptive catch-up) in `Markdown.tsx`, and trace writes batched at 500 ms / 128 events with byte-based rotation (`session/trace.ts`).
- All of this exists because of the incidents recorded in `docs/PITFALLS.md`. It's battle-tested, not speculative.

---

## Verdict

**Strengths** — Best-in-class process boundary: the renderer imports zero Electron and talks a clean ~110-method RPC contract (`packages/shared/src/ipc.ts`), the backend is Electron-free by design, and an HTTP+SSE server with remote prompt/abort/approve already exists and works (`backend/src/lan/server.ts`); genuinely excellent streaming/backpressure engineering, strict TS, 83 test files, real dark theming, and a permission/approval UX far beyond a TUI.

**Weaknesses** — Requirement (d) has three hard misses that are architectural, not cosmetic: extension-provided UI is deliberately stubbed to no-ops (`session/ui-context.ts:81-110`), extension custom messages aren't rendered, and there is no `!` bash mode, no steering, no terminal, no file browser, and no session tree; requirement (a) is unmet because the browser UI (`src/lan-web`, 2.4k LOC) is a separate thin app, not the desktop renderer; there is no list virtualization, no code signing, one maintainer, and the entire codebase plus its two excellent design docs are in Chinese.

**Upstream-fragility** — Coupling is much broader than advertised: 20 backend files import pi (not the one the docs claim), including a deep subpath `@earendil-works/pi-ai/providers/all`, an instantiated `Theme` class with ~40 required fields, direct SDK-internal mutation at `pi-backend.ts:833` (`session.agent.state.messages = ...`), pi's raw event union as the renderer wire format, and electron-builder copying three deep `dist/` paths out of the pi package — and it is already 3 pi releases behind (0.84.3 pinned vs 0.85.1 published four days ago) despite daily commits. `patches/` is clean, though: one patch, and it targets `thinking-orbs`, not pi.

**(i) Adding a browser/remote mode** — Moderate, and unusually cheap for Electron: ~2–4 weeks. Swap the preload for a WS/HTTP transport (one ~180-line file), mount `PiBackend` in a Node server (much of it copyable from `lan/server.ts`), then handle the ~10 native-capability RPCs (dialogs, `openExternal`, updater, userData persistence, UI-plugin esbuild, OAuth redirect) and build a real auth model — the current single shared bearer token with a 5-client cap is not VPS-grade.

**(ii) Staying in sync with upstream pi** — Hard and permanently expensive: with pi shipping every ~3.4 days, you are maintaining ~10k LOC of backend that re-implements permissions, subagents, todo, webfetch and context management on top of pi's extension hooks, against pinned exact versions and an un-buffered live event contract — my recommendation is to treat percho as a **reference implementation to study and selectively lift from** (the IPC contract, `shared/src/transcript/`, `event-conflator.ts`, `event-slim.ts`, `stream-guard.ts`, `lan/server.ts` are all worth stealing outright, MIT-licensed) rather than as a base to build your product on, unless you are prepared to own that entire adapter layer and to work in a Chinese-commented codebase.
