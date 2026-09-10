<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here is the evaluation.

---

# pi-gui evaluation

## 1. Architecture

**Workspace packages** (`pnpm-workspace.yaml`: `apps/*`, `packages/*`, `video`)

| Package | LOC | Role |
|---|---|---|
| `apps/desktop` | 22.6k src + 13.9k electron + 15.9k tests | The Electron app: React renderer + main + preload |
| `packages/pi-sdk-driver` | ~6.0k | Adapter over `@earendil-works/pi-coding-agent` |
| `packages/session-driver` | 578 | Pure-type contract (`SessionDriver`, `SessionDriverEvent`, `RuntimeSnapshot`). No runtime deps. |
| `packages/catalogs` | 89 | Workspace/session catalog types + storage iface |
| `apps/website` | 1.1k | Next.js 15 marketing site |
| `video` | — | Remotion demo renderer |

**`pi-sdk-driver` is not thin.** Despite `packages/pi-sdk-driver/AGENTS.md` insisting "keep this package a thin compatibility layer," it is ~6,000 lines, dominated by `src/session-supervisor.ts` (2,551 lines) and `src/runtime-supervisor.ts` (1,031 lines). It implements the `SessionDriver` interface (`src/pi-sdk-driver.ts`, 197 lines, pure delegation) on top of pi's `AgentSession`/`SessionManager`, and adds substantial logic pi does not provide: a cross-process advisory session-lease file protocol (`src/session-lease.ts`), a JSON catalog store (`src/json-catalog-store.ts`, 440 lines), transcript disk-tailing/caching, per-session event queues, session-tree/fork navigation, and an LLM thread-title generator (`src/thread-title-generator.ts`) that spins up a whole second agent session per new thread.

**Process model: pi runs in the Electron main process, in-process.** There is no utility process, no forked child, no worker. `apps/desktop/electron/app-store.ts:209` does `this.driver = new PiSdkDriver(driverOptions)` directly in main, and `SessionSupervisor` calls pi's `createAgentSessionRuntime` in the same V8 isolate. The only child processes are `execFile("git", …)` (`electron/app-store-diff.ts`, `electron/worktree-manager.ts`) and `node-pty` for the terminal (`electron/terminal-service.ts:294`). Consequence: an unhandled throw inside pi, or a CPU-bound pi operation, stalls the window; and pi's whole provider dependency tree (AWS SDK, OpenAI, Google GenAI, Mistral and more) is loaded into main.

**IPC design — the good news and the bad news.**

Good: the renderer **never imports Electron**. There is no `ipcRenderer`, no `require("electron")`, no `remote` anywhere under `apps/desktop/src`. It talks exclusively to a `window.piApp` object (`apps/desktop/src/global.d.ts`, typed as `PiDesktopApi` in `apps/desktop/src/ipc.ts:285+`), which is 99 methods of `Promise`-returning functions plus `on*(cb) => unsubscribe` subscriptions, over 96 string channels. Only **7 renderer files** touch `piApp` at all. The renderer builds as a stock Vite bundle with `base: "./"` and a plain `index.html`. This is a genuinely clean, serializable, transport-agnostic boundary — better than most Electron apps.

Bad: **the protocol is a full-state-snapshot broadcast, not a delta protocol.** Nearly every one of the 99 methods returns the *entire* `DesktopAppState` (29 fields including all workspaces, all worktrees, all runtime snapshots per workspace, all session commands, all queued composer messages with **base64 image attachments inline**, orchestration children, etc. — `apps/desktop/src/desktop-state.ts:297-329`). Even `updateComposerDraft(text)` returns the whole state. Every publish does `structuredClone(state)` per window (`electron/app-store.ts:283`). See §6.

**Rendering stack.** React 19.1 + `react-dom` 19.1, `@vitejs/plugin-react`, electron-vite 5, Vite 6. **No Tailwind, no component library, no CSS-in-JS** — hand-written CSS (~5.5k lines across `apps/desktop/src/styles/*.css`, with `main.css` alone at 2,763 lines). Markdown: `react-markdown` 10 + `remark-gfm` only (no rehype plugins, no KaTeX, no Mermaid). Syntax highlighting: `highlight.js` **10.7.3** (a 2021 release), with only **five** languages registered — ts, js, json, python, bash (`apps/desktop/src/syntax-highlight.ts:1-13`), capped at 500 highlighted lines. Terminal: `@xterm/xterm` 6 + fit/clipboard/web-links addons. Drag/drop: `@dnd-kit`. Diffing: `diff` 8.

**State management: none.** No Redux/Zustand/Jotai/TanStack — confirmed absent from `pnpm-lock.yaml`. The renderer is a single `useState` holding the pushed snapshot (`apps/desktop/src/app/desktop-app-state.ts:4-55`), with a revision-number guard to drop out-of-order snapshots. All logic lives in main. `App.tsx` is 1,071 lines.

**Theming is the strongest part of the UI layer.** `apps/desktop/src/styles/tokens.css` is a well-documented design-token system (4px spacing base, 11/12/14/16px type ramp, radius ramp, motion tokens) explicitly derived from Codex. Dark mode is pure CSS-variable reassignment via `color-mix()` over foreground/accent colors, so most rules need no dark override. `theme-presets.ts` (816 lines) defines ~45 named theme tokens for runtime preset switching, with OS `system`/`light`/`dark` following via `electron/theme-manager.ts`. The screenshot confirms the result: it genuinely looks like Codex.

## 2. Coupling to pi

**Every pi import is from the top-level `@earendil-works/pi-coding-agent` entry point.** No deep subpath imports, and `pi-agent-core` / `pi-ai` / `pi-tui` are never imported directly by app code (they arrive only as transitive deps). Complete list:

- `packages/pi-sdk-driver/src/runtime-supervisor.ts:3-14` — `DefaultPackageManager`, `DefaultResourceLoader`, `SettingsManager`, `parseFrontmatter`, `stripFrontmatter`, + types `PackageSource`, `ExtensionFactory`, `PathMetadata`, `ResolvedPaths`, `ResolvedResource`; line 31 `AuthStatus`, `AuthStorage`, `ModelRegistry`
- `packages/pi-sdk-driver/src/session-supervisor.ts:3-16` — `ModelRegistry`, `SessionManager`, + types `AgentSessionRuntime`, `AgentSession`, `AgentSessionEvent`, `CreateAgentSessionOptions`, `ExtensionFactory`, `ExtensionCommandContextActions`, `ExtensionUIDialogOptions`, `ExtensionUIContext`, `ExtensionWidgetOptions`, `SessionInfo`
- `packages/pi-sdk-driver/src/npm-package-fallback.ts:1-12` — `SessionManager`, `SettingsManager`, `createAgentSessionFromServices`, `createAgentSessionRuntime`, `createAgentSessionServices`, `getAgentDir`
- `packages/pi-sdk-driver/src/thread-title-generator.ts:1-9` — `SessionManager`, `SettingsManager`, `createExtensionRuntime`, `createAgentSession`, `ResourceLoader`, `AuthStorage`, `ModelRegistry`
- `packages/pi-sdk-driver/src/runtime-deps.ts:2` — `AuthStorage`, `ModelRegistry`, `getAgentDir`
- `packages/pi-sdk-driver/src/session-schema.ts:2` — `CURRENT_SESSION_VERSION`
- `packages/pi-sdk-driver/src/session-supervisor-utils.ts:2`, `src/pi-sdk-driver.ts:1` — types only
- `apps/desktop/electron/main.ts:17`, `electron/app-store-orchestration.ts:4`, `electron/orchestration-runtime.ts:1-7` — `AgentToolResult`, `ExtensionContext`, `ExtensionAPI`, `ExtensionFactory`, `ToolDefinition` (types only)
- `apps/desktop/scripts/assert-runtime-model-registry.mjs:1`, `tests/helpers/electron-app.ts` (×4), `tests/live/extensions-dialogs.spec.ts:58-59` (`@earendil-works/pi-ai` `Type`, `defineTool`)

**But there are three deliberate reach-throughs into pi internals** — this is the real breakage surface, and it contradicts the "documented SDK APIs only" story:

1. `packages/pi-sdk-driver/src/session-supervisor-utils.ts:71-83` — `forcePersistSession()` calls `sessionManager._rewriteFile()` and then sets `sessionManager.flushed = true`, with the comment *"Pi 0.80 defers first writes until the assistant response; keep its **internal** append/create mode aligned when the desktop forces an early file."* Version-specific private-state manipulation.
2. `packages/pi-sdk-driver/src/session-supervisor.ts:1536-1542` — `emitModelSelection()` reaches for `session._emitModelSelect(...)` via `as unknown as`, to fire pi's internal model-select event so extensions observe GUI-initiated model changes.
3. `packages/pi-sdk-driver/src/runtime-supervisor.ts:203, 236, 263` — casts `SettingsManager` to a locally-declared `ProjectWritableSettingsManager { markProjectModified(); saveProjectSettings(); }` shim (defined line 66-69) to write project settings.

(1) and (2) are defensively optional-chained and would silently no-op on rename — meaning upstream drift produces *silent behavioural regressions*, not loud crashes. (3) would throw.

**`patches/` — good news: the one patch is dead.** `patches/@mariozechner__pi-ai@0.60.0.patch` targets `@mariozechner/pi-ai@0.60.0`, but the lockfile pins `@earendil-works/pi-ai@0.80.6` (the package was rescoped upstream), and there is **no `pnpm.patchedDependencies` key** anywhere — not in root `package.json`, not in `pnpm-workspace.yaml`, not in `pnpm-lock.yaml`. It is an orphaned artifact that pnpm ignores. Its content: it removed the `"127.0.0.1"` host binding from four OAuth callback servers (ports 53692, 51121, 8085 and 1455) so they bind all interfaces instead of loopback. Historically that was almost certainly a *headless/remote-access* workaround — notable, because it is exactly the problem you would hit again in a VPS deployment. Today: **no active pi patching. Clean.**

**Pinned pi version: `0.80.6`**, declared as `^0.80.6` in `packages/pi-sdk-driver/package.json` and `apps/desktop/package.json`, and **hard-pinned again** as a string literal in `apps/desktop/scripts/assert-packaged-runtime-deps.mjs:94` (`requiredPiCodingAgentVersion = "0.80.6"`).

**The hidden coupling tax is packaging, not imports.** `apps/desktop/package.json` explicitly lists ~60 of pi's *transitive* dependencies as its own direct dependencies — the entire AWS Bedrock/Smithy stack, `@google/genai`, `@mistralai/mistralai`, `openai`, `undici`, `typebox`, `jiti`, `proxy-agent`, `partial-json`… with the comment in `apps/desktop/scripts/assert-packaged-runtime-deps.mjs:10-11`: *"Keep packaging-sensitive runtime transitive deps explicit; electron-builder can omit hoisted pnpm dependencies."* Plus `.npmrc` forces `node-linker=hoisted`. **Every pi upgrade that changes a provider dependency requires hand-editing that list in two files.**

Worse, `apps/desktop/scripts/assert-runtime-model-registry.mjs` is a **hardcoded model-catalog canary** that fails the build unless the bundled pi exposes `openai-codex/gpt-5.6-{luna,sol,terra}` and two other vendors’ pinned model ids with specific reasoning/image/max-thinking capability flags. This runs in `verify:packaged-runtime-deps`, gating Linux and Windows CI and every release. When upstream rotates its model catalog — which for a project shipping every ~3 days is a matter of weeks — **the release pipeline breaks**, not the app.

## 3. Feature coverage vs requirement (d)

| Capability | Status | Evidence |
|---|---|---|
| Slash commands | **Yes** — 11 host commands (`/model /thinking /tree /status /login /logout /settings /scoped-models /session /name /compact /reload`) | `apps/desktop/src/composer-commands.ts:92-205`; menu in `src/hooks/use-slash-menu.tsx` |
| Extension commands | **Yes** — merged into slash menu from pi | `packages/pi-sdk-driver/src/session-supervisor.ts:1896-1935` (`collectSessionCommands`, source `"extension"`) |
| Extension-provided UI dialogs | **Partial** — 10 structured kinds: confirm/input/select/editor/notify/status/widget/title/editorText/reset | `packages/session-driver/src/types.ts:236-296`; UI in `apps/desktop/src/extension-session-ui.tsx` |
| **Extension custom UI** | **NO — explicitly refused** | `packages/pi-sdk-driver/src/unsupported-host-ui.ts:44-53` rejects `custom`, `onTerminalInput`, `setEditorComponent`, `setFooter`, `setHeader` with *"Terminal-only … is not supported in pi-gui. Use pi in the terminal."* Widgets render as **ANSI-stripped plain text lines**, not rich UI (`extension-session-ui.tsx:7`, `buildWidgetBlocks`) |
| Custom extension messages | Partial — only via the host-UI request channel | 5 references; no generic message bus |
| Model switching | **Yes** — global / per-repo / per-session scopes | `src/model-selector.tsx`, `src/settings-models-section.tsx` |
| Thinking level | **Yes** — global, per-session | 228 refs; `/thinking` |
| Provider login/OAuth | **Yes** | `src/settings-providers-section.tsx`, `RuntimeLoginCallbacks`, `tests/core/login-prompt.spec.ts` |
| API keys + custom OpenAI-compatible endpoints | **Yes**, incl. model probing | `src/settings-custom-endpoints-section.tsx` (448 lines), `pi-sdk-driver/src/custom-provider-store.ts` |
| Sessions list / resume | **Yes** — JSONL files are source of truth | `packages/pi-sdk-driver/src/json-catalog-store.ts` |
| Branching / forking | **Yes** — fork-from-message + session tree navigator | `src/fork-modal.tsx`, `src/tree-modal.tsx` (802 lines), `/tree` |
| Compaction | **Yes** — `/compact [instructions]`, delegates to `session.compact()` | `pi-sdk-driver/src/session-supervisor.ts:854-867` |
| Skills | **Yes** — dedicated view + enable/disable + `/skill:*` commands | `src/skills-view.tsx` |
| Prompt templates | **Yes** — surfaced as slash commands | `session-supervisor.ts:1911, 2192-2193` (`session.promptTemplates`) |
| Settings editing | **Yes** — 6 sections (general/appearance/models/providers/endpoints/notifications) | `src/settings-*.tsx` |
| **`!` shell commands** | **NO** | Zero matches for a `!` composer prefix anywhere |
| Image attachments | **Yes** — paste, drag-drop, file picker | `src/composer-attachments.ts`, `tests/native/{paste,attach-image}.spec.ts` |
| **Tool approvals / permission gating** | **NO** | Zero approval logic. The only hit is a *notification setting label* "Needs input or approval" (`src/settings-notifications-section.tsx:86`). Tools run per pi's own config with no GUI gate. |
| Steer / follow-up queueing | **Yes** — queue, edit, reorder, promote-to-steer | `src/queued-composer-messages.tsx`; `SessionMessageDeliveryMode = "steer" \| "followUp"` |
| Abort | **Yes** — `cancelCurrentRun` | preload; `session-supervisor.ts` |
| Multi-agent orchestration | **Yes** — 4 injected tools (`create_child_thread`, `list_threads`, `read_thread`, `send_message_to_thread`) + supervision loop | `electron/orchestration-runtime.ts`, `electron/app-store-orchestration.ts` |
| Worktrees | **Yes** — per-thread git worktree create/remove | `electron/worktree-manager.ts`, `electron/app-store-worktree.ts` |
| Terminal | **Yes** — real PTY, xterm 6 + node-pty, multi-session tabs | `electron/terminal-service.ts`, `src/terminal-panel.tsx` |
| Diff viewer | **Yes** — changed-files list, inline diff, stage | `src/diff-panel.tsx` (757 lines), `electron/app-store-diff.ts` |
| Git | Read/stage only — `status --porcelain`, `diff`, `diff --cached`, `diff --no-index`, `add`. **No commit/branch/push UI.** | `electron/app-store-diff.ts:32-123` |

Two hard gaps against your requirement (d): **tool approvals** (absent entirely) and **extension-provided custom UI** (deliberately refused as terminal-only). `!` bash commands are also missing, though the integrated terminal partly compensates.

## 4. Web suitability

**Better than you would expect, with three concrete blockers.**

The renderer is already a transport-agnostic web app: no Electron imports, 99 async methods + event subscriptions on one injected `window.piApp` object, standard Vite build with relative `base`. Swapping the transport means writing one new `piApp` implementation backed by WebSocket/HTTP — you would not touch `App.tsx`, the timeline, the composer, or the CSS.

Electron-only leaks in the renderer, all in `apps/desktop/src`:

1. **`piApp.getPathForFile(file): string`** (`src/ipc.ts:295`, used `src/composer-attachments.ts:176`) — wraps Electron `webUtils.getPathForFile`. Returns a host filesystem path from a dropped `File`. **Impossible in a browser**; you must upload bytes instead. Small, localized fix.
2. **`piApp.readClipboardImage(): ComposerImageAttachment | null`** — **synchronous**, backed by `ipcRenderer.sendSync` (`electron/preload.ts`, `src/ipc.ts:395`). Called from two keydown handlers (`src/hooks/use-session-composer.tsx:222`, `src/hooks/use-new-thread-controller.tsx:295`). Must become async over a network; the calling code is written around a sync return. Small but touches event handlers.
3. **`piApp.platform: NodeJS.Platform`** — used for ⌘-vs-Ctrl labels and terminal key handling (`src/topbar.tsx:53-54`, `src/terminal-panel.tsx:215-221`, `src/ipc.ts:161`). Trivial: read from `navigator` instead. Note this is *client* platform, and in remote mode it would incorrectly report the server's OS.

Everything else in the 99-method surface is already plain serializable JSON. Native-shell methods (`openWorkspaceInFinder`, `pickWorkspace`, `toggleWindowMaximize`, `openSystemNotificationSettings`, OS notifications) need browser fallbacks — a server-side directory browser instead of the native folder dialog, Web Notifications instead of `Notification`, no-op for window chrome.

**Two things that make this materially easier than a typical Electron port:**

- **Multi-client is already designed in.** `AppStore.projectStateForView(view, state, previousView)` (`electron/app-store.ts:258+`) projects a per-client view of shared state, keyed by `webContents.id` in a `windowViews` map (`electron/main.ts:399-441`). There is a passing `tests/core/multi-window.spec.ts`. So concurrent clients with independent selected-workspace/session/view already work — that is the hardest part of a browser port and it is done.
- **The `session-driver` package is an intentional swap seam.** `plans/pi-app-mvp/plan.md` states the goal outright: *"keeping a low-drift path to track upstream `pi-mono` and later swap to the official future `pi` WebSocket server with limited client churn"* and *"Keep the durable client boundary small enough to survive a future server swap."* The architecture was built for this.

**The real obstacle is not the API surface — it is the payload shape.** Every state push is a `structuredClone` of the entire `DesktopAppState`, including base64 image attachments, sent on *every* streaming event. Over LAN IPC that is merely wasteful; over a VPS WAN link it is unusable. A browser/remote mode requires replacing the snapshot broadcast with a delta protocol — a main-process rework, not a renderer rework. See §6.

Also note: the app assumes the server owns the filesystem, git, and PTYs. On a remote Linux VPS that is *correct by construction* — but auth flows would resurface the exact loopback-binding problem that dead patch once solved, and there is no authentication, no session isolation between users, and no TLS anywhere in the codebase. It is a single-user local daemon.

## 5. Quality

**Tests: unusually strong for a solo project.** 75 Playwright specs against a real Electron build (`apps/desktop/tests/`), split into lanes: `core` (45 specs, default + CI on macOS), `live` (14, needs real provider auth), `native` (3, foreground OS integration), `production` (10, runs against packaged/signed artifacts incl. release-zip smoke and relaunch-from-/Applications), `unit` (1), `dev` (1), `demo` (1). Plus 7 `node --test` unit files in `packages/pi-sdk-driver/test/`. Test code is 15.9k lines — 40% the size of the app.

**CI** (`.github/workflows/ci.yml`): 4 jobs — typecheck + driver unit tests + release-helper tests on Ubuntu; website build; desktop core E2E on macOS; Linux packaging with runtime-dep verification; and a Windows packaging job. Plus `desktop-core-trend.yml` tracking flakiness.

**Release** (`.github/workflows/release.yml`): a 12-job pipeline — preflight version check → build-{macos,linux,windows} → stage-draft → verify-draft-{macos,linux,windows} → publish → verify-published-{macos,linux,windows} → sync-homebrew. macOS is signed (`CSC_LINK`) and notarized (App Store Connect API key, hardened runtime, entitlements). **Windows is a fully first-class, code-signed release target** — `build-windows` requires `WINDOWS_CSC_LINK`/`WINDOWS_CSC_KEY_PASSWORD`, produces NSIS installer + portable exe (x64), and runs `verify-windows-release.ps1 -SmokePackages` to verify signatures and architecture, at both draft and published stages. **The README is stale** when it says "public beta for macOS (Apple Silicon) and Linux (AppImage)." There is also a dedicated `.agents/skills/testing-windows-desktop/SKILL.md` documenting real Windows gotchas (ConPTY, non-ASCII `%USERPROFILE%` breaking electron-builder, cmd.exe vs POSIX shell in tests). Windows support is real and maintained — a significant plus for your requirement (a).

**TypeScript: strict and then some.** `tsconfig.base.json` sets `strict: true`; `apps/desktop/tsconfig.json` and `tsconfig.electron.json` add `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `forceConsistentCasingInFileNames`, `isolatedModules`; `packages/pi-sdk-driver/tsconfig.json` adds `exactOptionalPropertyTypes` and `verbatimModuleSyntax`. Genuinely high.

**Linting: nonexistent.** No `.eslintrc*`, no `eslint.config.*`, no `biome.json` anywhere. No workspace package defines a `lint` script, so root `pnpm lint` (`pnpm -r --if-present lint`) is a **silent no-op** — despite CONTRIBUTING.md instructing contributors to run it and PRs to pass it.

**Code size:** 59,615 lines of TS/TSX/MTS/MJS across 263 files, plus ~5.5k lines of CSS.

**Unfinished areas.** `docs/` contains **no markdown at all** — only 6 images and a duplicate `docs/readme/` copy of the demo assets. `plans/` has 3 files: `pi-app-mvp/plan.md` (505 lines, the original architecture plan, largely delivered), `phase-1-codex-parity/plan.md` (228 lines — states 92% confidence, flags *"true parallel background session runs may expose hidden pi SDK assumptions around subscription scope and session status restoration"*, and defers worktrees/automations/"broader host UI / **approvals** / widgets" to Phase 2 — approvals were never built), and `sidebar-unseen-notification-consistency/plan.md` (49 lines, a completed bug post-mortem). **Zero TODO/FIXME/HACK/XXX comments in the entire source tree** — either genuinely clean or aggressively groomed.

**Maturity signals:** version `0.1.0-beta.33` (33 beta releases), MIT licensed, Homebrew cask with automated tap sync, in-app update checker polling GitHub releases every 4h (`electron/update-checker.ts`). Security posture is correct: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` (`electron/main.ts:302-309`).

**Abandonment signal:** the clone is a single squashed commit (`eb9a738`, "Merge pull request #82", 2026-07-28) so commit-cadence history is unavailable — but PR #82 plus 33 betas indicates real sustained activity up to that point. Sole author (`matthew.lam@robinhood.com`); bus factor 1.

## 6. Performance-relevant choices

**Virtualization: yes, hand-rolled.** `apps/desktop/src/conversation-timeline.tsx:385-495` implements `VirtualizedTranscriptList` from scratch: `ResizeObserver` + passive scroll listener drive a viewport state, per-row measured heights cached in a ref with `estimateTimelineItemHeight()` fallback, prefix-sum offsets, binary-ish `findStartIndex`/`findEndIndex`, `OVERSCAN_PX` padding, absolute positioning. Competent, but it recomputes `rowHeights` and the full `rowOffsets` array **on every render** (line 447-455) — O(n) per frame over all transcript items, not just visible ones. Paired with `use-timeline-scroll.ts` (722 lines) for stick-to-bottom behaviour.

**Streaming/batching of updates: this is the weak point.** In `apps/desktop/electron/app-store.ts`, the session-event handler's `finally` block (lines 2334-2338) runs on **every** `SessionDriverEvent` — including every `assistantDelta` token chunk:

```
} finally {
  const snapshot = this.emit();
  this.publishSelectedTranscriptFor(event.sessionRef);
  await this.emitSessionEvent(event, snapshot);
}
```

`this.emit()` fans out to every window via `publishStateToWindow` → `projectStateForWindow` → `projectStateForView`, which does `structuredClone(state)` (line 283) and then `webContents.send(stateChanged, projected)`. `publishSelectedTranscriptFor` sends the **entire transcript array** for the session (`SelectedTranscriptRecord.transcript`, `src/desktop-state.ts:186-193` — no revision marker, no delta).

So each streamed chunk deep-clones the whole app state (base64 images included) and re-serializes the whole transcript. That is **O(transcript²) serialization per run**, unbatched — no `requestAnimationFrame` coalescing, no debounce, no throttle on this path, and the driver's per-session `eventQueue` only serializes ordering, it does not merge deltas. Renderer-side there is no `startTransition` or `useDeferredValue` either; `requestAnimationFrame` appears only in scroll/fit logic, and the only real debounce in the app is a 150ms one on thread search (`src/hooks/use-thread-search.ts:96`).

There *is* awareness of the problem — `apps/desktop/AGENTS.md` warns *"Keep composer and timeline behavior fast on hot paths; avoid full-state disk writes for keystrokes"*, and there is coalescing on adjacent paths (`refreshSessionCommandsCoalesced`, `schedulePersistUiState`). But the main streaming path is uncoalesced. On a local machine with a fast IPC bus and short sessions this is survivable; on a WAN link to a VPS, or in a 500-message session, it is not.

---

## Verdict

**Strengths.** The renderer/main boundary is genuinely clean — zero Electron imports in 22.6k lines of renderer, one injected 99-method `window.piApp` object touched by only 7 files, plus an already-working per-client state projection and multi-window support; the UI is a real, polished, token-driven Codex-style dark shell; test and release engineering (75 Playwright specs, 12-job signed/notarized pipeline with **first-class signed Windows NSIS + portable builds**) far exceed the norm for a solo project; TypeScript is strict; feature coverage is broad (worktrees, PTY terminal, diff panel, session tree/fork, orchestration, compaction, skills, prompt templates, custom endpoints); and `patches/` is a dead orphan, so there is **no active patching of pi**.

**Weaknesses.** The IPC protocol is a full-`structuredClone` state-snapshot broadcast fired on every streaming token with zero coalescing (`app-store.ts:283, 2334-2338`) — fine locally, unusable over a WAN, and the single biggest thing you would have to rip out; `pi-sdk-driver` is ~6k lines, not "thin", and reaches into three pi internals (`SessionManager._rewriteFile`/`.flushed`, `AgentSession._emitModelSelect`, `SettingsManager.markProjectModified`) that will fail *silently*; pi runs in-process in main with no isolation; **tool approvals do not exist at all** and extension custom UI is explicitly refused as terminal-only (`unsupported-host-ui.ts`); `!` bash commands are missing; there is no linter despite CONTRIBUTING claiming one; syntax highlighting is highlight.js 10.7.3 with five languages; and `docs/` has no documentation in it.

**Abandonment risk: moderate-to-high.** Single author, single squashed commit at 2026-07-28 (~6 weeks stale as of today), version 0.1.0-beta.33, bus factor 1. The specific decay mechanism is not the SDK imports — it is `apps/desktop/scripts/assert-runtime-model-registry.mjs`, which hard-fails the build unless bundled pi still exposes `gpt-5.6-{luna,sol,terra}` and two other pinned model ids with exact capability flags, plus the ~60 hand-maintained pi transitive deps duplicated across `apps/desktop/package.json` and `assert-packaged-runtime-deps.mjs` (which also hard-pins `"0.80.6"`). Against a project shipping every ~3 days, **the release pipeline rots before the app does** — so if you fork, budget for deleting the model canary first.

**(i) Adding a browser/remote mode: medium — surprisingly tractable at the API layer, real work at the protocol layer.** Roughly 1-2 weeks for a functional prototype: reimplement `window.piApp` as a WebSocket client (mechanical, the interface is already fully typed and serializable in `src/ipc.ts`), fix three Electron leaks (`getPathForFile` → byte upload, `readClipboardImage` → async, `platform` → `navigator`), and stub the native-shell methods. Multi-client already works via `projectStateForView`. Then budget **considerably more** for the thing that actually matters: replacing the full-snapshot broadcast with a delta protocol, or the app will be unusable over a VPS link. Add auth, TLS, and per-user isolation — none exist. Also re-solve the OAuth loopback-binding problem that dead patch documents.

**(ii) Keeping in sync with upstream pi: medium-to-high, and the cost is concentrated in packaging, not code.** The import surface is well-behaved (top-level entry points only, ~25 symbols) and `packages/session-driver` was deliberately built as a swap seam — the MVP plan names the future pi WebSocket server as the target. But every pi bump means: re-verify three private-API reach-throughs that fail silently, update ~60 explicitly-listed transitive deps in two places, bump the hard-pinned `"0.80.6"` string, and satisfy (or delete) a model-catalog canary that upstream will invalidate on its own schedule. At pi's ~3-day cadence that is a recurring chore measured in hours-per-bump, and it is chore work an absent maintainer will not be doing for you.
