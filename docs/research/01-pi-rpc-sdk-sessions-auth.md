<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I explored the RPC/JSON/SDK surfaces, session storage, auth, and the HTML exporter. Findings below; all paths absolute, line numbers from the working tree at `ce5ec9ca3` (v0.85.1, branch `fork`).

---

# 1. RPC mode (`pi --mode rpc`)

## 1.1 Entry points and transport

- CLI: `/srv/pi/packages/coding-agent/src/main.ts:111-122` (`resolveAppMode`) — `--mode rpc` wins over TTY detection; `/srv/pi/packages/coding-agent/src/main.ts:930-932` calls `runRpcMode(runtime)`.
- Dedicated entry: package export `"./rpc-entry"` → `dist/bundle/rpc-entry.js`, source `/srv/pi/packages/coding-agent/src/rpc-entry.ts` (sets `process.title=pi-rpc`, `PI_CODING_AGENT=true`, `AI_AGENT=pi`, silences process warnings, then `main(["--mode","rpc", ...argv])`).
- Implementation: `/srv/pi/packages/coding-agent/src/modes/rpc/rpc-mode.ts` (824 lines), types `/srv/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts`, framing `/srv/pi/packages/coding-agent/src/modes/rpc/jsonl.ts`.
- Transport: **JSON Lines over stdin/stdout, LF-only framing**. `serializeJsonLine` (`jsonl.ts:11`) writes `JSON.stringify(x) + "\n"`; `attachJsonlLineReader` (`jsonl.ts:24`) splits on `\n` only and strips a trailing `\r`. `docs/rpc.md:28-37` explicitly forbids Node `readline` (it also splits on U+2028/U+2029 which are legal inside JSON strings).
- stdout hygiene: `runRpcMode` calls `takeOverStdout()` (`rpc-mode.ts:55`, impl `/srv/pi/packages/coding-agent/src/core/output-guard.ts:44`) which redirects all normal `process.stdout.write`/`console.log` to **stderr**, so stdout carries only protocol records. Protocol writes go through `writeRawStdout` with ENOBUFS/EAGAIN retry, and the agent event subscription awaits `waitForRawStdoutBackpressure()` (`rpc-mode.ts:361-363`) so a slow client throttles the agent instead of dropping output.
- Three kinds of stdout records: `{"type":"response",...}`, `{"type":"extension_ui_request",...}`, and session events (`{"type":"<event>"}`), plus `{"type":"extension_error",...}` (`rpc-mode.ts:349`).
- Correlation: every command may carry `id`; the response echoes it. Only `bash_execution_update` events echo an `id`.
- Shutdown: stdin `end` → graceful shutdown (`rpc-mode.ts:804-807`); SIGTERM always, SIGHUP on non-Windows (`rpc-mode.ts:366-380`), exit codes 143/129; an extension calling the shutdown handler sets a flag consumed after `agent_settled` (`rpc-mode.ts:345-347`, `747-750`).

## 1.2 Complete command set

Authoritative union: `/srv/pi/packages/coding-agent/src/modes/rpc/rpc-types.ts:20-74`. Handlers: `rpc-mode.ts:386-720`.

**Prompting / run control**
| Command | Fields | Meaning |
|---|---|---|
| `prompt` | `message`, `images?`, `streamingBehavior?: "steer"\|"followUp"` | Send user prompt. Response emitted after *preflight* accept, not after completion (`rpc-mode.ts:394-416`). Extension commands (`/x`) run immediately even while streaming; skills `/skill:name` and prompt templates are expanded server-side. |
| `steer` | `message`, `images?` | Queue steering message, delivered after the current assistant turn's tool calls, before the next LLM call. |
| `follow_up` | `message`, `images?` | Queue message delivered only when the agent stops. |
| `abort` | – | Abort and wait for idle. |
| `clear_queue` | – | Returns `{steering: string[], followUp: string[]}` and removes them. |
| `new_session` | `parentSession?` | Replace active session; `{cancelled}` if an extension vetoed via `session_before_switch`. |

**State / model / thinking**
| Command | Result |
|---|---|
| `get_state` | `RpcSessionState` (`rpc-types.ts:96-109`): `model?`, `thinkingLevel`, `isStreaming`, `isCompacting`, `steeringMode`, `followUpMode`, `sessionFile?`, `sessionId`, `sessionName?`, `autoCompactionEnabled`, `messageCount`, `pendingMessageCount`. Note: **no** `autoRetryEnabled`, **no** context usage, **no** tool list. |
| `set_model` `{provider, modelId}` | full `Model` object; fails if not in `modelRuntime.getAvailableSnapshot()` (`rpc-mode.ts:472-480`). Session-only, not persisted to settings. |
| `cycle_model` | `{model, thinkingLevel, isScoped}` or `null`. |
| `get_available_models` | `{models: Model[]}` (only models with working auth). |
| `set_thinking_level` `{level}` | `off\|minimal\|low\|medium\|high\|xhigh\|max`. |
| `cycle_thinking_level` | `{level}` or `null`. |
| `get_available_thinking_levels` | `{levels}` (`["off"]` for non-reasoning models). |

**Queue modes / compaction / retry**
`set_steering_mode {all|one-at-a-time}`, `set_follow_up_mode {…}`, `compact {customInstructions?}` → `CompactionResult`, `set_auto_compaction {enabled}`, `set_auto_retry {enabled}`, `abort_retry`.

**Bash**
`bash {command, excludeFromContext?}` → `BashResult {output, exitCode, cancelled, truncated, fullOutputPath?}`; streams `bash_execution_update` while running; goes through the extension `user_bash` hook first (`rpc-mode.ts:563-584`). `abort_bash`. Note **`excludeFromContext` is implemented but undocumented in `docs/rpc.md`**.

**Session**
`get_session_stats` → `SessionStats` incl. `contextUsage` (`/srv/pi/packages/coding-agent/src/core/agent-session.ts:270-287`, `ContextUsage` at `/srv/pi/packages/coding-agent/src/core/extensions/types.ts:290-296`); `export_html {outputPath?}`; `switch_session {sessionPath}`; `fork {entryId}` → `{text, cancelled}`; `clone` (fork at current leaf, `rpc-mode.ts:621-631`); `get_fork_messages`; `get_entries {since?}` → `{entries, leafId}` (entry id is a durable cursor); `get_tree` → `{tree, leafId}`; `get_last_assistant_text`; `set_session_name {name}`; `get_messages`.

**Discovery**
`get_commands` → extension commands + prompt templates + `skill:<name>` skills, each `{name, description?, source, sourceInfo}` (`rpc-mode.ts:682-713`).

> **Doc bug to be aware of:** `docs/rpc.md:832-851` still shows `location` and `path` fields for `get_commands`. The implementation returns `sourceInfo` (`rpc-types.ts:81-90`; shape in `/srv/pi/packages/coding-agent/src/core/source-info.ts:6-12`: `{path, source, scope: "user"|"project"|"temporary", origin: "package"|"top-level", baseDir?}`). This was an intentional breaking change (CHANGELOG lines 2418, 2424, 2434). Trust the types, not that doc section.

Unknown commands return `{success:false, error:"Unknown command: …"}` with the request `id` (`rpc-mode.ts:715-718`); malformed JSON returns `command:"parse"` (`rpc-mode.ts:756-766`).

## 1.3 Events and streaming

RPC forwards **every** `AgentSessionEvent` through `toJsonEvent` (`rpc-mode.ts:355-360`, `/srv/pi/packages/coding-agent/src/modes/json-event.ts:47-62`).

- Base agent events: `/srv/pi/packages/agent/src/types.ts:431-446` — `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start|update|end`.
- Session-level additions: `/srv/pi/packages/coding-agent/src/core/agent-session.ts:144-185` — `agent_end` gains `willRetry`; plus `agent_settled`, `queue_update`, `compaction_start`, `compaction_end`, `auto_retry_start|end`, `summarization_retry_scheduled|attempt_start|finished`, `bash_execution_update`, and **three events that `docs/rpc.md` does not list**:
  - `entry_appended {entry}` — emitted **only** when an extension calls `pi.appendEntry(customType, data)` (`agent-session.ts:2614-2620`). It is *not* a general per-entry feed.
  - `session_info_changed {name}` — on `setSessionName` (`agent-session.ts:3112-3117`).
  - `thinking_level_changed {level}` — on any effective thinking change (`agent-session.ts:1828-1836`).
- **There is no session event for model changes.** `setModel` only emits the extension-level `model_select` (`agent-session.ts:1698`), so a GUI must use the `set_model`/`cycle_model` response or re-poll `get_state`.

Streaming shape (`json-event.ts:20-37`): `message_update` is delta-only — the cumulative `message` field and `assistantMessageEvent.partial` were removed in 0.85.0 (CHANGELOG:319) to avoid quadratic output. Top-level `usage` carries the latest cumulative provider usage. `toolcall_start` is augmented with `id` + `toolName` (`json-event.ts:26-33`). Delta types are the 9 in `/srv/pi/packages/ai/src/types.ts:546-556` minus `start`/`done`/`error`, which the agent loop maps to `message_start`/`message_end` instead (`/srv/pi/packages/agent/src/agent-loop.ts:315-357`). `message_end.message` is authoritative. `tool_execution_update.partialResult` is **cumulative**, so a client can just replace its rendering.

Errors during a run are not a separate event: they arrive as an `AssistantMessage` with `stopReason: "error"|"aborted"` and `errorMessage`.

## 1.4 Tool approval / interaction

**There is no built-in tool-permission or approval system in pi.** Grep for `approval|permission` over `src/` returns only clipboard comments and an unrelated llama extension. Pi runs with the caller's privileges (also stated in `/srv/pi/FORK.md`).

The supported way to build approvals for a GUI is an **extension** that hooks `tool_call`:

- `ToolCallEventResult` (`/srv/pi/packages/coding-agent/src/core/extensions/types.ts:1125-1134`): `{block?: boolean, reason?: string, terminate?: boolean}`; arguments are modified by mutating `event.input` in place.
- Reference implementation: `/srv/pi/packages/coding-agent/examples/extensions/permission-gate.ts` (checks `ctx.hasUI`, then `ctx.ui.select(...)`, returns `{block:true, reason:"Blocked by user"}`).
- In RPC mode `ctx.ui.select/confirm` become `extension_ui_request` records → your GUI renders the dialog → you answer with `extension_ui_response`. So: **ship a small extension with the GUI (`-e /path/to/approval.ts`) and the approval loop works over stock RPC.**

Related hooks a GUI may want: `user_bash` (intercept/replace direct bash), `input` (transform/block user input; direct RPC `steer`/`follow_up` now route through it — CHANGELOG:17), `session_before_switch` / `session_before_fork` (veto), `project_trust`.

## 1.5 Extension UI sub-protocol

Implemented in `rpc-mode.ts:136-311`; types `rpc-types.ts:246-291`; docs `docs/rpc.md:1184-1374`.

- **Blocking dialogs** (`extension_ui_request` → wait for `extension_ui_response` with matching `id`): `select {title, options, timeout?}`, `confirm {title, message, timeout?}`, `input {title, placeholder?, timeout?}`, `editor {title, prefill?}`.
- Responses: `{type:"extension_ui_response", id, value}` / `{… confirmed}` / `{… cancelled:true}`.
- If `timeout` is present the agent auto-resolves with the default (`undefined` / `false`) — the client need not track it (`createDialogPromise`, `rpc-mode.ts:91-131`). An `AbortSignal` on the extension side also auto-resolves.
- **Fire-and-forget** (no response): `notify {message, notifyType}`, `setStatus {statusKey, statusText?}`, `setWidget {widgetKey, widgetLines?, widgetPlacement}`, `setTitle {title}`, `set_editor_text {text}`.
- Degraded/no-op in RPC (`rpc-mode.ts:163-311`): `custom()` → `undefined`; `setWorkingMessage/setWorkingVisible/setWorkingIndicator/setHiddenThinkingLabel/setFooter/setHeader/setEditorComponent/addAutocompleteProvider/onTerminalInput/setToolsExpanded` → no-ops; `getEditorText()` → `""`; `getToolsExpanded()` → `false`; `getAllThemes()` → `[]`; `getTheme()` → `undefined`; `setTheme()` → `{success:false}`; `pasteToEditor()` → `setEditorText`; `setWidget` ignores component factories (string arrays only).
- `ctx.mode === "rpc"` and `ctx.hasUI === true` (`ExtensionMode` = `"tui"|"rpc"|"json"|"print"`, types.ts:307).

Reference client: `/srv/pi/packages/coding-agent/examples/rpc-extension-ui.ts` (paired with `examples/extensions/rpc-demo.ts`); protocol tests in `/srv/pi/packages/coding-agent/test/rpc.test.ts`, `rpc-jsonl.test.ts`, `rpc-prompt-response-semantics.test.ts`, `rpc-client-*.test.ts`, and `stdout-cleanliness.test.ts`.

## 1.6 Typed TS client (`RpcClient`)

`/srv/pi/packages/coding-agent/src/modes/rpc/rpc-client.ts`, re-exported from the package root (`src/index.ts:355`). Spawns `node <cliPath> --mode rpc` (line 94), one method per command, `onEvent()`, `waitForIdle()`, `collectEvents()`, `promptAndWait()`.

Caveats for a GUI:
- **It has no `extension_ui_response` path** — `handleLine` (line 516-535) treats `extension_ui_request` as a plain event and never replies, so extension dialogs would hang. Write your own client (or wrap it) if you use extension UI.
- Hard-coded 30 s per-request timeout (line 575), 60 s default idle timeout, `start()` sleeps 100 ms (line 133), stderr is echoed to the parent's stderr (line 104).

## 1.7 What the TUI can do that RPC cannot

Built-in slash commands (`/srv/pi/packages/coding-agent/src/core/slash-commands.ts:19-43`) are **interactive-only**; they are not reachable through `prompt` (`docs/rpc.md:853`). Missing over RPC:

- `/tree` — in-place branch navigation with optional branch summaries. `AgentSession.navigateTree()` exists (`agent-session.ts:3134`) and is exposed to extensions via `commandContextActions.navigateTree` (`rpc-mode.ts:329-337`), but **there is no RPC command**. Workaround: a small extension command invoked as `prompt "/mytree <id>"`.
- `/resume` session picker — and `--resume` at startup opens a TUI picker (`main.ts:410-425`), unusable headless. There is **no RPC "list sessions"**; enumerate `~/.pi/agent/sessions/` yourself or use `SessionManager.list()` in a Node helper.
- `/login`, `/logout` (see §5), `/settings`, `/trust`, `/scoped-models`, `/reload`, `/import` (JSONL import — `AgentSessionRuntime.importFromJsonl`, `agent-session-runtime.ts:361`), `/export` to **JSONL** (`AgentSession.exportToJsonl`, `agent-session.ts:3486`; only HTML is exposed over RPC), `/share` (secret GitHub gist), `/copy`, `/changelog`, `/hotkeys`, `/llama`, `/quit`.
- Tool management: `getAllTools()` / `setActiveToolsByName()` (`agent-session.ts:946`, `966`) — no RPC equivalent.
- Startup-only in all modes: `--session <path|id>`, `--session-id`, `--continue`, `--fork`, `--no-session`, `--session-dir`, `--name`, `--models`, `--tools/--exclude-tools/--no-tools`, `-e` extensions, `--system-prompt`. Changing any of these means restarting the subprocess.
- `@file` arguments are **rejected** in RPC (`main.ts:640-643`) — the GUI must read files and inline text/`ImageContent` itself.
- Project trust: RPC never prompts; behaviour comes from `defaultProjectTrust` in global settings plus `--approve`/`-a` / `--no-approve`/`-na` (`docs/usage.md:126`, `docs/settings.md:16`).
- Editor-side features (autocomplete, `@`-file search, image paste, external editor, keybindings, themes, custom footers/headers/overlays, fullscreen transcript search) are inherently TUI.

---

# 2. `--mode json` and `--print`

Both run `/srv/pi/packages/coding-agent/src/modes/print-mode.ts:33` (`runPrintMode`), single-shot: prompts come from argv (`initialMessage`, `messages`), then the process exits. `main.ts:118` also selects print mode automatically when stdin **or** stdout is not a TTY.

- `--mode json`: first stdout line is the **session header** (`print-mode.ts:126-131`, e.g. `{"type":"session","version":3,"id":…,"timestamp":…,"cwd":…}`), then one `JsonAgentSessionEvent` per line (`print-mode.ts:108-112`) — identical event encoding to RPC (same `toJsonEvent`), but **no** `response` records, **no** `extension_ui_request`, and extension errors go to stderr (`print-mode.ts:98-100`). Backpressure handled like RPC.
- `--print` / `-p` (text): prints only the `text` content blocks of the final assistant message; on `stopReason === "error"|"aborted"` prints `errorMessage` to stderr and exits 1 (`print-mode.ts:135-152`).
- Extension mode is `"json"` / `"print"`; no `uiContext` is bound (`print-mode.ts:71-77`) → extension dialogs are unavailable (`ctx.hasUI` false), so a `permission-gate`-style extension will block by default.
- Docs: `/srv/pi/packages/coding-agent/docs/json.md` (98 lines).

Verdict for a GUI: json/print are fine for one-shot tasks (batch jobs, "run this prompt" buttons), useless as the interactive backbone.

---

# 3. SDK

## 3.1 Published surface

`/srv/pi/packages/coding-agent/package.json`:
- `"."` → `dist/index.js` + `dist/index.d.ts` — the supported SDK.
- `"./rpc-entry"` → `dist/bundle/rpc-entry.js`.
- `"./client"` and `"./experimental/plugin"` map to `"source"` only, and `"files"` excludes `!dist/client`, `!dist/experimental`, `!dist/cli/experimental` → **not usable from the npm package; explicitly unsupported** (CHANGELOG:36 — the 0.85.1 fix that made them source-only says "the supported local SDK and stdio RPC API are unchanged").
- `docs/` and `examples/` ship inside the package; `getDocsPath()` / `getExamplesPath()` / `getReadmePath()` are exported (`src/index.ts:6-14`).

## 3.2 Main API (`/srv/pi/packages/coding-agent/src/index.ts`)

- Factories (`src/core/sdk.ts`, exported at `index.ts:204-231`): `createAgentSession(options?)` → `{session, extensionsResult, modelFallbackMessage?}`; `createAgentSessionServices`, `createAgentSessionFromServices`, `createAgentSessionRuntime`, `AgentSessionRuntime`; tool factories `createCodingTools`, `createReadOnlyTools`, `createRead/Bash/PowerShell/Edit/Write/Grep/Find/LsTool`.
- `AgentSession` (`src/core/agent-session.ts:306`) — public members with line numbers: `subscribe:853`, `dispose:877`, `state:901`, `model:906`, `thinkingLevel:911`, `isStreaming:916`, `isIdle:921`, `systemPrompt:926`, `getActiveToolNames:939`, `getAllTools:946`, `getToolDefinition:956`, `setActiveToolsByName:966`, `isCompacting:984`, `messages:993`, `steeringMode:998`, `followUpMode:1003`, `sessionFile:1008`, `sessionId:1013`, `sessionName:1018`, `scopedModels:1023`/`setScopedModels:1028`, `promptTemplates:1033`, `prompt:1175`, `steer:1425`, `followUp:1437`, `sendUserMessage:1571`, `clearQueue:1608`, `pendingMessageCount:1619`, `abort:1640`, `waitForIdle:1648`, `setModel:1679`, `cycleModel:1721`, `setThinkingLevel:1814`, `cycleThinkingLevel:1843`, `getAvailableThinkingLevels:1859`, `setSteeringMode:1902`, `setFollowUpMode:1911`, `compact:1967`, `abortCompaction:2120`, `abortBranchSummary:2128`, `setAutoCompactionEnabled:2457`, `bindExtensions:2466`, `reload:2839`, `abortRetry:2970`, `setAutoRetryEnabled:2987`, `executeBash:3004`, `recordBashResult:3042`, `abortBash:3071`, `setSessionName:3112`, `navigateTree:3134`, `getUserMessagesForForking:3335`, `getSessionStats:3357`, `getContextUsage:3409`, `exportToHtml:3461`, `exportToJsonl:3486`, `getLastAssistantText:3499`, `extensionRunner:3547`.
- `AgentSessionRuntime` (`src/core/agent-session-runtime.ts:74`) owns session **replacement**: `switchSession:196`, `newSession:226`, `fork:262` (`{position:"before"|"at"}` — clone is `fork(leafId,{position:"at"})`), `importFromJsonl:361`, `dispose:406`, `setRebindSession:117`, `setBeforeSessionInvalidate:129`, plus `session`, `services`, `cwd`, `diagnostics`. After replacement you must re-`subscribe` and re-`bindExtensions` (`docs/sdk.md:163-180`).
- Event type: `AgentSessionEvent` (`agent-session.ts:144-185`); listener `AgentSessionEventListener:188`; options `PromptOptions:242-253` (`expandPromptTemplates`, `images`, `streamingBehavior`, `source`, `preflightResult`); `ModelCycleResult:262`; `SessionStats:270`.
- Also exported: `SessionManager` + all entry types (`index.ts:232-257`), `SettingsManager` (`258-268`), `ModelRuntime` / `ModelRegistry` / `resolveCliModel` / `resolveModelScopeWithDiagnostics` / `CredentialSynchronizationError` (`176-191`), `DefaultResourceLoader` (`201-202`), the entire extension type surface (`53-172`), tool definitions + `defineTool` (`282-338`), `ProjectTrustStore` (`339-345`), run modes `InteractiveMode` / `runPrintMode` / `runRpcMode` / `RpcClient` (`349-365`), TUI components incl. `ModelSelectorComponent`, `SessionSelectorComponent`, `TreeSelectorComponent`, `LoginDialogComponent`, `OAuthSelectorComponent`, `SettingsSelectorComponent` (`367-405`), theme utilities `highlightCode`, `getMarkdownTheme`, `getLanguageFromPath` (`406-416`), `copyToClipboard`, `resizeImage`, `convertToPng` (`417-424`), and `main()` itself (`347`).
- Docs: `/srv/pi/packages/coding-agent/docs/sdk.md` (1226 lines) + 13 runnable examples in `/srv/pi/packages/coding-agent/examples/sdk/` (`01-minimal` … `13-session-runtime`).
- Doc bug: `docs/sdk.md:211` shows images as `{type:"image", source:{type:"base64", mediaType, data}}`. The real `ImageContent` is `{type:"image", data, mimeType}` (`/srv/pi/packages/ai/src/types.ts:367-371`) — the RPC doc has it right.

## 3.3 Stability

- Version `0.85.1`, pre-1.0. The SDK is treated as **public and documented**, but breaking changes are shipped in ordinary minor releases: `### Breaking Changes` sections appear in ~40 releases in `/srv/pi/packages/coding-agent/CHANGELOG.md` (recent: lines 143, 316, 510, 720, 754 — i.e. 0.84.3, 0.84.0, 0.83.0, 0.80.8, 0.80.7).
- SDK/RPC-affecting examples: 0.84.0 removed cumulative `message` from `message_update` (CHANGELOG:319), changed `ModelRegistry.getApiKeyAndHeaders()` and `ModelRuntime.setRuntimeApiKey()` signatures (322-326); an earlier release replaced `location`/`path` with `sourceInfo` in `get_commands` (2424-2434); another switched RPC framing to strict LF JSONL (2699-2716).
- Signal on what upstream considers supported: CHANGELOG:36 — "The experimental `client` and `experimental/plugin` subpaths and server/client commands are now source-only … **the supported local SDK and stdio RPC API are unchanged**."

**Practical read:** the two stable, documented integration surfaces are (a) stdio RPC and (b) the root SDK import. Both break occasionally at minor versions, RPC less often and with changelog entries + doc updates. RPC has the smaller, more explicitly versioned contract.

---

# 4. Session storage

## 4.1 Location and naming

- Default: `~/.pi/agent/sessions/--<cwd with leading separator stripped and `/`,`\`,`:` → `-`>--/<timestamp>_<sessionId>.jsonl` (`/srv/pi/packages/coding-agent/src/core/session-manager.ts:476-481` and `:949`). `sessionId` defaults to a **uuidv7** (`session-manager.ts:208-210`), overridable via `--session-id` (validated at `:212-218`).
- Agent dir override: `PI_CODING_AGENT_DIR` (`/srv/pi/packages/coding-agent/src/config.ts:508, 528-534`); sessions dir override precedence `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `sessionDir` setting (`docs/settings.md:250-260`, `config.ts:509, 572-574`).
- Other files in `~/.pi/agent/`: `auth.json`, `models.json`, `models-store.json`, `settings.json`, `trust.json`, `extensions/`, `skills/`, `prompts/`, `themes/`, `bin/`, `npm/` (`config.ts:536-579`).

## 4.2 Format

`/srv/pi/packages/coding-agent/docs/session-format.md` (450 lines) is complete and current. JSONL; line 1 = `SessionHeader` (`{type:"session",version:3,id,timestamp,cwd,parentSession?}`); all other lines are tree nodes with `{type,id,parentId,timestamp}`. Entry types: `message`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, `session_info`. Message union = `UserMessage | AssistantMessage | ToolResultMessage | BashExecutionMessage | CustomMessage | BranchSummaryMessage | CompactionSummaryMessage`. Versions 1→3 auto-migrate on load. Context rebuild rules (`buildContextEntries` / `buildSessionContext`) documented at `session-format.md:333-353`; both are exported (`src/index.ts:232-257`).

## 4.3 Concurrency / safety for external readers

- Writes are `appendFileSync` per entry (`session-manager.ts:1054`), **but** there is a deferred-flush path: before the first assistant message exists, entries are buffered and the whole file is rewritten with `openSync(file,"wx")` once an assistant message arrives (`session-manager.ts:1029-1056`). Version migration rewrites the whole file with `"w"` (`_rewriteFile`, `:993-1003`). `createBranchedSession` writes a new file with flag `"wx"` (`:1652`).
- **No lockfile is used for session files** (`proper-lockfile` is used only for `auth.json`, `settings.json`, `trust.json`, the package-manager update lock, and the *experimental* session worker — grep results across `src/`). One writer per session file is assumed.
- Reading from another process: safe for **listing and snapshot reads** — `SessionManager.list(cwd, sessionDir?, onProgress?)` (`:1670`) and `SessionManager.listAll(...)` (`:1685-1745`) are read-only, best-effort, swallow errors, and return `SessionInfo {path, id, cwd, name?, parentSessionPath?, created, modified, messageCount, firstMessage, allMessagesText}` (`:174-188`). `SessionManager.open(path)` gives full tree access; `ReadonlySessionManager` (`:190-206`) is the read-only method subset.
- Tailing a *live* session file from outside is **not** recommended: the early-session rewrite and migration rewrite can truncate/replace the file underneath you, and there is no fsync/lock protocol. For live data use RPC `get_entries {since}` (durable entry-id cursor, explicitly designed for this — `docs/rpc.md:719`) plus `leafId` to detect branch moves.

## 4.4 `packages/session-backends`

Only `/srv/pi/packages/session-backends/sqlite-node` exists → `@earendil-works/pi-session-backend-sqlite-node` v0.85.1. **It is not a backend for the coding-agent's `SessionManager`.** It implements `SqliteSessionRepo` for the *new* `@earendil-works/pi-agent-core` harness `Session`/`SessionRepo` abstraction (README lines 1-25; one sqlite file per session under a directory, or a shared container via `databasePath`). The coding agent uses it nowhere in the stable path; the harness `JsonlSessionRepo` appears only under `src/experimental/` (`session-worker.ts:22,540`, `server.ts:10,384`, `mini/*`). Treat it as forward-looking infrastructure, not a current integration point.

---

# 5. Auth / credentials

## 5.1 Storage

- `~/.pi/agent/auth.json`, one entry per provider id, created mode `0600`, parent dir `0700`; all writes are lock-guarded read-modify-write via `proper-lockfile` (`/srv/pi/packages/coding-agent/src/core/auth-storage.ts:25, 48-110, 111-140`). Path override `ModelRuntime.create({authPath})`.
- Credential shape (`/srv/pi/packages/ai/src/auth/types.ts:17-37`): `{type:"api_key", key?, env?}` or `{type:"oauth", access, refresh, expires, …}`.
- `key` supports `!shell command` (stdout, cached per process), `$ENV` / `${ENV}` interpolation, `$$`/`$!` escapes, or a literal (`docs/providers.md:159-185`). API-key credentials may carry a provider-scoped `env` block (Cloudflare account/gateway ids, Azure settings, proxies) that takes precedence over the process env (`docs/providers.md:141-157`).
- Resolution order: `--api-key` → `auth.json` → environment variable → `models.json` custom provider keys (`docs/providers.md:310-317`); the SDK adds runtime overrides on top (`docs/sdk.md:446-451`).
- Env-var ↔ provider-key table: `docs/providers.md:69-106`, source of truth `/srv/pi/packages/ai/src/env-api-keys.ts`.
- Exported helper: `readStoredCredential` (`src/index.ts:26`).

## 5.2 Driving login from a GUI

- `ModelRuntime` (`/srv/pi/packages/coding-agent/src/core/model-runtime.ts`): `create({authPath, modelsPath, credentials, allowModelNetwork, modelRefreshTimeoutMs, signal})`, `getProviders():384`, `checkAuth(providerId):400`, `isUsingOAuth:458`, `login(providerId, type, interaction):681`, `logout(providerId):690`, `setRuntimeApiKey:536`, `removeRuntimeApiKey:549`, `refresh({providers, signal, force})`, `getAvailable()`, `getModel()`. Failure to re-synchronize local state after a committed credential change throws the exported `CredentialSynchronizationError` with `{providerId, operation, credential, cause}` (`docs/sdk.md:483`).
- **A GUI can fully drive OAuth** through the `AuthInteraction` callback contract (`/srv/pi/packages/ai/src/auth/types.ts:156-161`):
  - `prompt(AuthPrompt)` where `AuthPrompt` is `text | secret | select {options} | manual_code` (`:125-130`) — `select` returns the option id;
  - `notify(AuthEvent)` where `AuthEvent` is `info {message, links}` | `auth_url {url, instructions}` | `device_code {userCode, verificationUri, intervalSeconds, expiresInSeconds}` | `progress {message}` (`:137-147`).
  That is exactly enough to render a browser-based or device-code login, and for headless/remote hosts the flows accept a pasted redirect URL or code (`docs/providers.md:51`, `manual_code` prompt kind).
- **There is no RPC command for login/logout/auth status.** Options for a browser GUI, in order of robustness:
  1. Node backend process using the SDK's `ModelRuntime` directly (recommended — gives you `getProviders`, `checkAuth`, `login`, `logout`, `setRuntimeApiKey`).
  2. `pi auth check|print-api-key|print-bearer-token` (`/srv/pi/packages/coding-agent/src/cli/auth-command.ts`; `check --json [--credentials] [--no-refresh]`, `print-bearer-token --min-expiry 30m`) — read-only status/tokens, requires `--provider` or `--model`.
  3. Have the user run `pi` and `/login` once in a terminal; the GUI then just consumes `auth.json`.
  4. Writing `auth.json` yourself is possible (documented format) but you'd bypass the lock discipline; prefer (1).
- Providers with OAuth/subscription flows today: OpenAI Codex, GitHub Copilot, xAI, OpenRouter (PKCE, mints a user API key), Radius (`docs/providers.md:15-56`).

---

# 6. Existing HTML/web renderer (`src/core/export-html`)

Yes — there is a complete, self-contained single-file session viewer. It is the closest existing thing to a web GUI and worth mining for the read-only transcript view.

- `/srv/pi/packages/coding-agent/src/core/export-html/index.ts`
  - `generateHtml(sessionData, themeName)` (`:143-175`) reads `template.html`, `template.css`, `template.js` and vendored `marked.min.js` + `highlight.min.js` from `vendor/`, injects them plus theme CSS variables, and embeds the session as **base64 JSON** in `<script id="session-data" type="application/json">` (`:160`, `template.html:39`).
  - `SessionData` (`:130-138`) = `{header, entries, leafId, systemPrompt?, tools?: {name,description,parameters}[], renderedTools?}` — i.e. the *whole entry tree*, not just the active branch.
  - Theme: `generateThemeVars` (`:111-128`) emits one CSS custom property per TUI theme color via `getResolvedThemeColors`/`getThemeExportColors`, with luminance-derived page/card/info backgrounds (`:42-106`).
  - Entry points: `exportSessionToHtml(sm, state, options)` (`:236`) — used by `/export` and RPC `export_html` via `AgentSession.exportToHtml` (`agent-session.ts:3461-3486`); `exportFromFile(inputPath, options)` (`:288`) — used by CLI `pi --export <in> [out]` (`main.ts:624`).
  - **Neither is re-exported from `src/index.ts`** — to reuse programmatically you either call RPC `export_html`, shell out to `pi --export`, or vendor the template.
- Rendering stack it reuses:
  - Markdown: `marked` (vendored `vendor/marked.min.js`, 43 KB; `marked` is a devDependency of the package), wrapped by `safeMarkedParse` (`template.js:1640`) with `sanitizeMarkdownUrl` (`:616`) and `escapeHtml` (`:607`).
  - Syntax highlighting: `highlight.js` 10.7.3 (vendored `vendor/highlight.min.js`, 122 KB) with `getLanguageFromPath` (`template.js:823`).
  - Tools: built-ins `bash|read|write|edit|ls` are rendered natively in JS (`TEMPLATE_RENDERED_TOOLS`, `index.ts:178`; `renderToolCall` `template.js:904`, `formatExpandableOutput` `:848`). **Extension/custom tools are pre-rendered server-side** by running their TUI `renderCall`/`renderResult` components at width 100 and converting ANSI → HTML (`/srv/pi/packages/coding-agent/src/core/export-html/tool-renderer.ts`, `ansi-to-html.ts`), producing collapsed/expanded HTML keyed by tool-call id.
- `template.js` is 1864 lines and already implements most of a transcript UI: tree sidebar with the same filter modes as `/tree` (`default`, `no-tools`, `user-only`, `labeled-only`, `all` — `template.html:21-25`), search (`getSearchableText` `:332`, `filterNodes` `:368`), active-path highlighting (`buildActivePathIds` `:116`), fold/unfold, per-entry deep links + copy-link buttons (`buildShareUrl` `:1096`, `renderCopyLinkButton` `:1165`), navigation (`navigateTo` `:1495`), header with model/tool/system-prompt panels and stats (`computeStats` `:1323`, `renderHeader` `:1366`), image modal, resizable sidebar, mobile layout.
- Assets ship in the npm package: `dist/core/export-html/{template.html,template.css,template.js,vendor/*.js}` (package.json `copy-assets`); resolved at runtime by `getExportTemplateDir()` (`config.ts:421-431`).
- Related: `/share` uploads the same HTML as a secret GitHub gist and links to `https://pi.dev/session/#<gistId>` (`config.ts:515-521`) — TUI-only.

---

# Architecture notes for your GUI

1. **Backbone: one `pi --mode rpc` subprocess per session.** It is the only surface upstream explicitly calls "supported" alongside the SDK, it is language-agnostic, it is covered by tests (`test/rpc*.test.ts`, `stdout-cleanliness.test.ts`), and its breaking changes are individually changelogged. Write your own JSONL client (LF-only split, strip trailing `\r`); do not use `RpcClient` unless you patch in `extension_ui_response`.
2. **Fill RPC's gaps with a thin Node "host" using the SDK**, not by re-implementing: session listing (`SessionManager.list/listAll`), auth/login (`ModelRuntime.login` + `AuthInteraction`), settings (`SettingsManager`), JSONL import/export, HTML export for sharing. This keeps the always-on, high-churn path (streaming, tools, compaction) on the narrow RPC contract and confines SDK-version churn to a few call sites.
3. **Implement everything RPC lacks *inside the agent* as one GUI extension** loaded with `-e`: tool approval (`tool_call` → `ctx.ui.select`), `/tree` navigation (`ctx.actions.navigateTree`), tool enable/disable, session rename, anything else. Extension commands are invocable over RPC via `prompt "/name args"` even mid-stream, and `ctx.ui.*` dialogs come back to you as `extension_ui_request`. This is the single highest-leverage design decision: it turns the extension API into your private RPC extension mechanism without forking pi.
4. **Transcript rendering:** consume `message_start` / `message_update` (delta-only, assemble by `contentIndex`) / `message_end` (authoritative) live, and use `get_entries {since}` + `leafId` for reconciliation, history, and reconnect. Steal `export-html/template.js` + `template.css` for the static rendering rules (markdown, hljs, tool cards, tree filters) rather than inventing them.
5. **Watch these specific fragile points across upstream merges:** `rpc-types.ts` (command/response unions), `json-event.ts` (delta encoding), `agent-session.ts:144-185` (event union), `slash-commands.ts:19-43` (built-in commands), `core/extensions/types.ts` (`ToolCallEventResult`, `ExtensionUIContext`), and `session-manager.ts` `CURRENT_SESSION_VERSION`.
6. **Do not build on** `packages/{client,server,protocol}`, `src/experimental/**`, `src/client`, or `./experimental/plugin`. They are the future multi-presentation architecture (Chord services `SessionDirectory`, `SessionManagement`, `Models`, `AgentController`, `Transcript`, `SlashCommands`, `PresentationUI` — see `/srv/pi/packages/coding-agent/src/experimental/services/README.md`), gated behind `PI_EXPERIMENTAL=1`, source-only in the published package, and explicitly unstable. It is, however, the surface a desktop/web GUI will eventually want — keep your GUI's internal API shaped like `AgentController` + `Transcript` so that migration is a transport swap.
