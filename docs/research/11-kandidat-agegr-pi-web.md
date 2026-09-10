<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here is the evaluation.

---

# agegr/pi-web — Evaluation

Repo: `<scratch>/gui-repos/agegr__pi-web` (single squashed commit `b1a7296`, no usable git history). v0.9.0, MIT, published as `@agegr/pi-web`.

## 1. Architecture

**Process model — one Node process, no pi subprocess.**
- `bin/pi-web.js:84` spawns exactly one child: `next start` (the Next.js production server). Nothing else. There is no `pi` CLI subprocess for the agent.
- The agent runs **in-process inside the Next.js server** via the SDK: `lib/rpc-manager.ts:2` imports `createAgentSessionServices` / `createAgentSessionFromServices`. The file name `rpc-manager.ts` is a misnomer — no RPC is involved (the `"rpc"` string appears only as the *mode* flag passed to pi's extension binder, `lib/rpc-manager.ts:347`).
- **One `AgentSessionWrapper` per pi session id**, not per browser session. Registry is `globalThis.__piSessions: Map<string, AgentSessionWrapper>` (`lib/rpc-manager.ts:1641`, `getRegistry()` at :1646). `globalThis` is used deliberately so the map survives Next hot-reload (documented in `AGENTS.md:126`).
- **A running turn survives closing the tab.** SSE disconnect only detaches a listener (`lib/agent-event-stream.ts` `cleanup()` calls `unsubscribe()`); the wrapper keeps running. Eviction is by a 10-minute idle timer (`SESSION_IDLE_TIMEOUT_MS`, `lib/rpc-manager.ts:127-148`, configurable via `PI_WEB_IDLE_TIMEOUT_MS`), and `resetIdleTimer()` refuses to evict while `isRunning()`. On reload, `ChatWindow` re-issues `GET /api/agent/[id]` and reconnects SSE if `state.isStreaming` (`AGENTS.md:156`).
- **Not multi-user.** Sessions are keyed globally by pi session id with no user/tenant dimension; any authenticated client can attach to any session. Auth is a single optional shared password (`PI_WEB_PASSWORD`) enforced in `proxy.ts` (Next 16 middleware) plus a host allow-list in `lib/request-security.ts`.

**Transport.**
- **SSE** for agent events: `app/api/agent/[id]/events/route.ts` → `lib/agent-event-stream.ts` (30 s heartbeat, snapshot-then-stream ordering, dedup of events already in the snapshot).
- **SSE** also for terminal output (`app/api/terminal/[id]/events/route.ts`, with `Last-Event-ID` resume and a 128 KiB UTF-16 ring buffer — `docs/terminal.md`) and for OAuth device-code flows (`app/api/auth/login/[provider]/route.ts`).
- **POST-per-command** for everything else: `POST /api/agent/[id]` takes `{type: "prompt" | "abort" | "fork" | ...}` (`app/api/agent/[id]/route.ts`), dispatched by `AgentSessionWrapper.send()`'s 27-case switch (`lib/rpc-manager.ts:569-990`).
- **Polling** only for the "which sessions are running" sidebar badge: `/api/agent/running` every 2.5 s, paused in background tabs (`AGENTS.md:162`), plus reconciliation polls of `GET /api/agent/[id]` during an active run and on `visibilitychange`/`online`.
- 51 API routes total (`find app/api -name route.ts`).

**State management.** No state library at all — no Redux/Zustand/Jotai/TanStack Query. Everything is React hooks: `hooks/useAgentSession.ts` (2115 lines) holds messages, streaming reducer, SSE lifecycle, fork/navigate, run-id reconciliation; `components/AppShell.tsx` (2692 lines) holds layout, URL state, tabs. Streaming deltas go through a pure reducer in `lib/streaming-message.ts`. Persistence is `localStorage`/`sessionStorage`.

**Rendering stack.** React 19.2 + Next 16.3.1 (App Router, Turbopack in dev, `--webpack` for build). Tailwind v4 via `@tailwindcss/postcss`, but most styling is hand-written CSS with CSS variables (`app/globals.css`, `app/settings.css`). **No component library** — every widget is bespoke, including all SVG icons. Markdown: `react-markdown` 10 + `remark-gfm`/`remark-math`/`remark-frontmatter` + `rehype-katex`/`rehype-raw`/`rehype-sanitize` (`lib/markdown.ts`). Syntax highlighting: `react-syntax-highlighter` (Prism). Mermaid 11 lazy-loaded (`components/MermaidBlock.tsx:54`). Terminal: `@xterm/xterm` 6 + fit addon. ANSI→HTML: `ansi_up`.

## 2. Coupling to pi

**Exact pins, all four packages at `0.85.1`** (`package.json`), no caret ranges. `next.config.ts:8-13` reads the installed pi version at build time and exposes it as `NEXT_PUBLIC_PI_VERSION`, displayed in `components/ChatWindow.tsx:1333` and `components/SessionSidebar.tsx:334`.

**All imports are package-root** — I found no deep `dist/` or `src/` internal paths. The only subpath is `@earendil-works/pi-ai/compat` (`app/api/models-config/test/route.ts:5`, a documented compat entrypoint). Full list of ~60 import sites is available; the APIs used:

- `pi-coding-agent` (47 imports): `createAgentSessionServices`, `createAgentSessionFromServices`, `AgentSession`, `SessionManager`, `SettingsManager`, `ModelRuntime`, `DefaultResourceLoader`, `DefaultPackageManager`, `ProjectTrustStore`, `hasTrustRequiringProjectResources`, `getAgentDir`, `getPackageDir`, `initTheme`, `Theme`, `parseFrontmatter`, `loadSkillsFromDir`, `buildContextEntries`, `convertToLlm`, `resolveModelScopeWithDiagnostics` (via `lib/model-scope.ts:6`), plus types `JsonAgentSessionEvent`, `SlashCommandInfo`, `ResourceDiagnostic`, `AgentSessionEvent`, `BashOperations`.
- `pi-agent-core` (8): types only — `ThinkingLevel`, `AgentMessage`, `AgentLoopTurnUpdate`, `PrepareNextTurnContext`.
- `pi-ai` (7): `getSupportedThinkingLevels`, `Type`, `createAssistantMessageEventStream`, types `Api`, `Model`, `Credential`, `AuthEvent`, `AuthPrompt`, `ImageContent`, `TextContent`.
- `pi-tui` (1): `KeybindingsManager`, `TUI_KEYBINDINGS` — `lib/rpc-manager.ts:3`, used to feed keystrokes into headless extension UI components.

**Deliberate decoupling layer.** `lib/pi-types.ts` (206 lines) defines structural interfaces — `AgentSessionLike`, `ExtensionUiContextLike`, `ToolInfo` — that duck-type the SDK rather than importing its concrete classes. `lib/agent-event-wire.ts` is a wire boundary that projects SDK events into a client shape and tolerates both old and new field names (`id`/`toolCallId`, `name`/`toolName`, `lib/agent-event-wire.ts:46-55`). `lib/normalize.ts` handles the `{id,name,arguments}` vs `{toolCallId,toolName,input}` mismatch (`AGENTS.md:142`).

**Version-tolerance shims exist but are thin.** `lib/rpc-manager.ts:341-372` feature-detects `typeof this.inner.bindExtensions === "function"` and falls back to `extensionRunner.setUIContext?.(uiContext, "rpc")` for older SDKs. `hooks/useAgentSession.ts:1276-1277` accepts both `compaction_start` and `auto_compaction_start`. That is roughly the extent of it — most of the surface assumes 0.85.1 shapes.

**Does it spawn `pi --mode rpc`?** No. The only place the pi CLI is executed as a process is session export: `app/api/sessions/[id]/export/route.ts:220` runs `node <pi cli> --export <file> <out>`, then post-processes the generated HTML to convert recursive tree helpers to iterative ones (`AGENTS.md:206`).

**Does it touch pi's files directly?** Yes, substantially — this is the biggest coupling risk after the SDK API itself:
- Session `.jsonl`: read directly by `lib/session-reader.ts` and `lib/session-list-scanner.ts`; it maintains its own index at `~/.pi/agent/pi-web-session-index.json` (`lib/session-list-scanner.ts:225`) and **rewrites whole session files** when cascade-reparenting on delete (`AGENTS.md:139`). It also appends its own custom entries `pi-web:tool-selection` into pi's session files (`docs/adr/0002`).
- `models.json`: `lib/models-config-store.ts:61` (GET/PUT via `/api/models-config`).
- `settings.json`: `lib/powershell-settings.ts:43-60` reads/writes `defaultTools`.
- `auth.json`: `lib/provider-credential-store.ts:56` parses it directly, though writes go through pi's `AuthStorage` under the same lock (`AGENTS.md:197`).
- `agents/settings.json`: `lib/subagent-settings.ts:15`.
- Writes `~/.pi/agent/web-push.json` (`lib/web-push.ts:40`).
- One genuine private-state poke: `(manager as unknown as { flushed: boolean }).flushed = true` (`lib/rpc-manager.ts:494`) to force a flush for bash-only sessions.

## 3. Feature coverage vs. requirement (d)

| Feature | Status | Evidence |
|---|---|---|
| Slash commands | **Yes, and future-proof.** Extension/prompt/skill commands are sent verbatim as prompt text — pi resolves them (`hooks/useAgentSession.ts:1310`). Only 6 pi-web builtins are intercepted client-side: `/compact /reload /name /session /copy /clone` (`components/ChatInput.tsx:173-179`). Palette groups by source with fuzzy rank. | `get_commands` at `lib/rpc-manager.ts:889` |
| Extension commands | Yes — `extensionRunner.getRegisteredCommands()` merged into the palette | `lib/rpc-manager.ts:891` |
| **Extension-provided UI** | **Yes — the most complete part of the project.** `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget` (both `string[]` and factory form), and `custom()` — arbitrary pi-tui components rendered **headlessly server-side** into ANSI lines, streamed to the browser, with keystrokes fed back via `extension_ui_input` and a real `KeybindingsManager`. Timeouts/countdown, abort, expiry all handled. No-ops for TUI-only bits (`setWorkingMessage`, `setFooter`, `setHeader`, autocomplete providers). | `createExtensionUiContext()` `lib/rpc-manager.ts:1473+`; `lib/custom-ui-terminal.ts`; `components/ExtensionWidgets.tsx`, `components/ExtensionStatusBar.tsx`; e2e test `e2e/extension-dialog.mjs` |
| Model switching | Yes, incl. `enabledModels` glob scoping delegated to the SDK's `resolveModelScopeWithDiagnostics()` | `lib/model-scope.ts`, `components/ModelSelector.tsx` |
| Thinking level | Yes, incl. mobile menu and thinking pins | `set_thinking_level` `lib/rpc-manager.ts:815`; `components/ThinkingIcon.tsx` |
| Provider login / OAuth | Yes — OAuth, device-code, and manual-code flows streamed over SSE | `app/api/auth/login/[provider]/route.ts` |
| API keys | Yes (store/delete; status endpoints never return the key) | `app/api/auth/api-key/[provider]/route.ts` |
| Sessions list / resume | Yes, grouped by project + worktree, with cost/context/compaction stats and full-text search | `app/api/sessions/route.ts`, `app/api/sessions/search/route.ts` |
| Branch / fork | **Both kinds.** `fork` → new independent `.jsonl`; `fork_branch`/`navigate_tree` → in-session branch. Plus `clone`. | `lib/rpc-manager.ts:718, 757, 779, 807`; `components/BranchNavigator.tsx` |
| Compaction | Yes — manual `/compact`, auto-compaction toggle, `abort_compaction`, and a parsed compaction-summary card | `lib/rpc-manager.ts:828, 857, 943`; `lib/compaction-summary.ts` |
| Skills | Yes — list, enable/disable (surgical frontmatter edit of `disable-model-invocation`), install via `npx skills add`, search skills.sh, update | `app/api/skills/*`, `components/SkillsConfig.tsx` |
| Prompt templates | Yes — surfaced as slash source `"prompt"` | `lib/rpc-manager.ts:899` |
| Settings editing | Partial. Rich UI for models/skills/plugins/subagents/appearance + PowerShell `defaultTools`. **No general `settings.json` editor.** | `components/SettingsPanel.tsx` (4 sections) |
| `!` bash commands | Yes, incl. `!!` for exclude-from-context, streaming output, abort | `components/ChatInput.tsx:523`; `lib/rpc-manager.ts:963` |
| Image attachments | Yes — paste, drag-drop, upload, preview, validation | `lib/image-attachments.ts`, `components/ImagePreview.tsx` |
| **Tool approvals** | **No.** There is no per-tool-call approve/deny prompt anywhere. Safety is instead (a) tool presets NONE/READ_ONLY/DEFAULT/FULL persisted per session, and (b) a project-trust gate for repo-controlled extensions/skills. | `lib/tool-presets.ts`; `components/ProjectTrustDialog.tsx`, `lib/project-trust.ts` |
| Steer / follow-up queueing | Yes, with a visible queue and `clear_queue` | `lib/rpc-manager.ts:862-879`; `hooks/useAgentSession.ts:1724+` |
| Abort | Yes — `abort`, `abort_bash`, `abort_compaction` | `lib/rpc-manager.ts:664, 943, 987` |
| Tree view | Yes — sidebar session tree; subagents nest, forks stay roots | `lib/session-tree.ts` |
| Session export | Yes — delegates to pi's exporter | `app/api/sessions/[id]/export/route.ts` |
| Terminal (xterm) | Yes — full PTY via node-pty, leases, reconnect-with-resume, restart | `components/TerminalPanel.tsx`, `lib/terminal-manager.ts`, `docs/terminal.md` |
| File browser | Yes, but **allow-listed, not general** — roots come from session cwds/project roots only | `components/FileExplorer.tsx`, `lib/path-security.ts` |
| Git diff | Yes — per-file diff in the viewer, plus git status | `app/api/git/diff/route.ts`, `components/FileViewer.tsx:1234` |
| Bonus | Sub-agents (own extension + runtime), git worktrees, PWA + Web Push notifications, system-prompt inspector, tool-definitions panel, chat minimap, DOCX/PDF/audio/image preview, completion sound | `lib/subagents.ts`, `lib/worktree.ts`, `public/sw.js`, `components/SystemPromptPanel.tsx`, `components/ChatMinimap.tsx` |

## 4. Desktop suitability

**No existing desktop code** — zero electron/tauri references in source. But the author explicitly designs for downstream Electron wrappers: `README.md:101-123` documents a cancelable `pi-web:session-row-contextmenu` DOM event so a wrapper can add native session context menus *without patching* `SessionSidebar`, and `README.md:125-147` documents a versioned `globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")]` registry.

**Structurally favorable:**
- `app/page.tsx` is 12 lines and renders one client component. There is **no SSR data fetching, no server actions** (`grep "use server"` → zero hits), no RSC data flow. 43 files carry `"use client"`. The UI is effectively an SPA.
- All backend logic sits in 51 plain API routes — portable to any Node HTTP server.

**Structurally awkward:**
- Not a static export. You must ship and run the **Next.js production server** (`next start`) inside the app. `next.config.ts` has no `output: "standalone"`, so packaging pulls in the full `node_modules` tree.
- `proxy.ts` (Next 16 middleware) gates auth and host trust — another Next-runtime dependency.
- `node-pty` is a **native module** requiring per-arch prebuilds and an Electron rebuild; `bin/prepare-terminal.js` already exists to patch macOS spawn-helper permissions, which hints at the friction. `next.config.ts:17` lists it in `serverExternalPackages`.
- Practical path: run `next start` as a child process from Electron's main process and point a `BrowserWindow` at `127.0.0.1:30141` — which is exactly what `bin/pi-web.js` already does minus the window. That is a small amount of work but yields a two-process app that bundles a full Next server.

**Windows readiness is unusually good** for a project of this kind: `toNativePath()`/`samePath()` path normalization is applied to all git output (`AGENTS.md:174` documents a real Windows bug they fixed), `bin/pi-web.js:107-113` avoids `shell: true` and uses `ComSpec` directly, and there is a PowerShell shell-tool setting (`lib/powershell-settings.ts`).

## 5. Quality

Genuinely high, with one structural caveat.

- **Tests: 164 `*.test.mjs` files, 18,200 LOC** of tests against 47,632 LOC of production TS/TSX (≈38% ratio). Run with the built-in `node --test` runner (`jiti` for TS imports) — no Jest/Vitest.
- **E2E:** Playwright/Chromium, hand-rolled runner `e2e/run.mjs` that spins up its own dev/prod server in a temp `PI_CODING_AGENT_DIR` with generated fixtures — no credentials needed. Covers a 5,000-message session, pagination, branch context, markdown/tool rendering, and extension dialog keyboard nav/expiry (`e2e/README.md`). Plus a separate terminal suite and a bench file (`lib/session-list-scanner.bench.mjs`).
- **CI:** `.github/workflows/ci.yml` — job 1 lint + `tsc --noEmit` + unit tests; job 2 clean build + e2e against `next start`, uploading traces on failure. Solid.
- **TypeScript:** `strict: true`. **Zero `: any`, zero `@ts-ignore`/`@ts-expect-error`, zero TODO/FIXME/HACK** across `app/components/hooks/lib`. Only 14 `eslint-disable` lines. This is exceptional discipline.
- **Docs:** unusually strong. `AGENTS.md` (20 KB) is a real architecture doc with ASCII diagrams and a "Key Design Decisions & Traps" section explaining non-obvious behavior (fork mutating wrapper state in-place, `parentSession` being display-only, path comparison on Windows). Three ADRs in `docs/adr/`. Focused guides for terminal, worktrees, i18n, release. `CONTEXT.md` even defines project vocabulary. The `AGENTS.md` file map is mildly stale — it omits ~15 newer routes (terminal, git, push, file-index, project-trust, subagents, sessions/search).
- **i18n:** hand-rolled, no framework. 644 keys × 3 packages (`en`, `zh-CN`, `zh-TW`) in `lib/i18n/messages/`. Missing keys fall back to English with a dev warning. Note the mismatch: READMEs exist in `ja` and `ru`, but the UI does not.
- **Code size:** large and concentrated. `AppShell.tsx` 2692, `ChatInput.tsx` 2661, `SessionSidebar.tsx` 2344, `ModelsConfig.tsx` 2173, `rpc-manager.ts` 2126, `useAgentSession.ts` 2115. **Six files over 2,000 lines** is the main maintainability weakness — `AgentSessionWrapper.send()` alone is a ~420-line switch.
- **pi version tracking:** exact pins at `0.85.1` for all four packages; no renovate/dependabot config; no compat matrix. Upgrading is a manual `npm install` + fix-what-breaks exercise.
- **Releases:** no `CHANGELOG.md`; release notes live on GitHub Releases. `docs/release.md` is a careful 7-step checklist (npm publish → commit bump → tag → generate notes from commits, bilingual). `npm run release` = `npm version patch && next build && npm publish`. Cadence can't be measured from this squashed clone, but v0.9.0 against pi 0.85.1 with issue references up to #617 in `e2e/README.md` implies an active, fast-moving project.
- **Hacks:** few and documented. The notable ones: forcing `manager.flushed = true` (`lib/rpc-manager.ts:494`), monkey-patching `agent.prepareNextTurnWithContext` to re-apply an exact system prompt after pi rebuilds its base prompt (`lib/rpc-manager.ts:411-425`), a `PlainTextTheme` subclass that neuters every ANSI method so extensions get a valid `Theme` (`lib/rpc-manager.ts:172-194`), and rewriting recursive helpers in pi's exported HTML to avoid stack overflow. One real packaging oddity: `react-markdown`, `react-syntax-highlighter`, `mermaid`, `katex`, `mammoth` are in **devDependencies** despite being runtime UI deps — this works only because the published package ships a prebuilt `.next`.

## 6. Performance-relevant choices

- **List virtualization: none.** No `react-window`/`react-virtual`/Virtuoso. Instead **incremental lazy loading**: render the last 50 entries, load 50 more when an `IntersectionObserver` sentinel at the top of the list fires, with scroll-anchor preservation (`lib/chat-lazy-load.ts`, `components/ChatWindow.tsx:628-640`). Consequence: a session scrolled fully back keeps every message mounted in the DOM. The e2e suite tests a 5,000-message session opening with exactly 50 entries, so the *initial* load is bounded — long-scroll memory is not.
- **Streaming rendering:** SSE deltas feed a pure reducer (`lib/streaming-message.ts`) that immutably updates one content block; `MessageView` is `memo`-wrapped (`components/MessageView.tsx:274`) so only the streaming bubble re-renders. There is **no explicit throttle/debounce/rAF batching of deltas** — it relies on React 19's automatic batching.
- **Markdown is re-parsed per delta.** `MarkdownBody` runs the full remark/rehype pipeline on every token for the streaming message. Mitigations: `CodeBlock` is memoized and **skips Prism tokenization entirely while `isStreaming`** (`components/MermaidBlock.tsx:269-325`), and Mermaid preview is disabled during streaming and dynamically imported. So the expensive parts are deferred, but the markdown AST rebuild per token remains.
- **Server side:** session-list scanner with an on-disk index and a TTL + generation-counter cache (`lib/session-reader.ts:180-212`), paginated context reads, bounded terminal output history (128 KiB), slow-SSE-consumer disconnection, and a shared start-lock so concurrent requests don't create duplicate AgentSessions.

---

## Verdict

**Strengths.** By far the most complete pi web UI you are likely to find: 47.6k LOC, 164 test files, real CI + Playwright e2e, strict TS with zero `any`/`@ts-ignore`/TODO, excellent architecture docs and ADRs — and it uniquely solves the hardest requirement, extension-provided UI, by rendering pi-tui components headlessly and streaming ANSI to the browser (`lib/rpc-manager.ts:1473+`). Coverage of (d) is ~95%: everything on your list except tool approvals and a general settings.json editor, plus bonuses (worktrees, subagents, PWA/push, xterm terminal). Windows path/shell handling is already battle-tested.

**Weaknesses.** Coupling to pi is *moderate, not minimal* — exact pins at `0.85.1`, ~60 import sites, direct read/write of `models.json`/`settings.json`/`auth.json`/session `.jsonl` (including whole-file rewrites and its own `pi-web:tool-selection` entries), plus private-state pokes (`manager.flushed`) and a monkey-patch of `agent.prepareNextTurnWithContext`. Six files exceed 2,000 lines. No true list virtualization; markdown re-parses per token. Single-user only; UI i18n is en/zh only.

**(i) Adapting to a Windows desktop app: easy-to-moderate (days).** The UI is a pure client SPA with no SSR or server actions, and the author already ships downstream-integration hooks for Electron. The realistic path is Electron main → spawn `next start` → point a BrowserWindow at loopback, which is what `bin/pi-web.js` already does. Frictions: you ship a full Next server (no `output: "standalone"`), `proxy.ts` middleware, and `node-pty` needs an Electron rebuild per arch. Tauri is a poor fit — you'd still need the Node sidecar.

**(ii) Staying in sync with upstream pi: moderate-to-hard, and it is *their* problem you'd inherit.** The good news is real: slash commands are passed through as text so new pi commands appear for free, `lib/pi-types.ts` duck-types the SDK, `lib/agent-event-wire.ts` isolates the event shape, and a few feature-detect shims exist (`bindExtensions`, dual compaction event names). The bad news: every pi release can break the on-disk format assumptions, the headless pi-tui component contract (`render(width) → string[]`), and the ~30 `AgentSessionLike` methods — and with pi shipping every ~3 days and no dependabot/compat matrix here, you are betting on this maintainer's cadence. Building your own would not make this easier; the coupling is inherent to exposing everything the TUI can do.

**Recommendation:** build on it rather than from scratch — the extension-UI bridge alone represents months of work you would otherwise repeat. Budget effort for (a) an Electron shell, (b) hardening the parts that touch pi's files directly, and (c) accepting that a pi upgrade is a recurring manual chore either way.
