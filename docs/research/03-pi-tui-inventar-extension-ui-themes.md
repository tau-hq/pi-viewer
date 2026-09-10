<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here is the report.

---

# 1. Interactive mode feature inventory

## 1.1 Screen regions (what a web GUI must reproduce)

Layout is assembled in `/srv/pi/packages/coding-agent/src/modes/interactive/chat-viewport.ts:22-46` (`createChatViewport`) and mounted at `/srv/pi/packages/coding-agent/src/modes/interactive/interactive-mode.ts:875-896`. Top→bottom:

| Region | Container field | Notes |
|---|---|---|
| Startup header | `builtInHeader` (`interactive-mode.ts:951`) | Logo + version, compact/expanded keybinding help, onboarding line. Replaceable via `ctx.ui.setHeader()` |
| Loaded resources | `loadedResourcesContainer` (`interactive-mode.ts:1642` `showLoadedResources`) | Collapsible `[Context] [Skills] [Prompts] [Themes] [Extensions]` sections with source scoping |
| Transcript / document | `documentContainer` → `chatContainer` | Wrapped in a `ScrollView` in fullscreen mode (`chat-viewport.ts:23`) |
| Pending messages | `pendingMessagesContainer` (`interactive-mode.ts:4368`) | `Steering: …` / `Follow-up: …` lines + "↳ Alt+Up to edit all queued messages" hint |
| Status row | `statusContainer` | Spinner/loader row, see 1.6 |
| Widgets above editor | `widgetContainerAbove` | extension `setWidget(..., {placement:"aboveEditor"})` |
| Editor | `editorContainer` | Replaced in place by every dialog (see 1.5) |
| Widgets below editor | `widgetContainerBelow` | `placement:"belowEditor"` |
| Footer | `footerContainer` → `FooterComponent` | see 1.4 |

Two TUI modes: `regular` (main screen, terminal scrollback) and `fullscreen` (alt screen, app-owned viewport with scrollbar, mouse selection, transcript search). `--tui-mode`, setting `tuiMode`.

## 1.2 Slash commands

Canonical list: `/srv/pi/packages/coding-agent/src/core/slash-commands.ts:19-43` (`BUILTIN_SLASH_COMMANDS`). Dispatch: `interactive-mode.ts:2964-3103`.

| Command | Meaning | Dispatch line |
|---|---|---|
| `/settings` | Open the settings menu (see 1.5) | 2970 |
| `/scoped-models` | Enable/disable + reorder models for Ctrl+P cycling | 2975 |
| `/model [pattern]` | Model picker; Ctrl+S saves as startup default | 2980 |
| `/thinking [level]` | Thinking level picker; Ctrl+S saves default | 2986 |
| `/export [file]` | Export session to HTML (default) or `.jsonl` | 2992 |
| `/import <file>` | Import + resume a session from JSONL | 2997 |
| `/share` | Upload as secret GitHub gist, get shareable HTML link | 3002 |
| `/copy` | Copy last assistant message to clipboard | 3007 |
| `/name <name>` | Set session display name | 3012 |
| `/session` | Show session file, ID, message count, tokens, cost | 3017 |
| `/changelog` | Render version history | 3022 |
| `/hotkeys` | Render full keyboard-shortcut table (incl. extension shortcuts) | 3027 |
| `/fork` | User-message selector → new session file from an earlier prompt | 3032 |
| `/clone` | Duplicate current active branch into a new session file | 3037 |
| `/tree` | Session tree navigator (branch switching, labels, filters) | 3042 |
| `/trust` | Save project trust decision to `~/.pi/agent/trust.json` | 3047 |
| `/login [provider]` | OAuth / API-key auth flow | 3052 |
| `/logout` | Remove provider auth | 3058 |
| `/new` | Start a new session | 3063 |
| `/compact [prompt]` | Manual compaction with optional custom instructions | 3068 |
| `/reload` | Reload keybindings, extensions, skills, prompts, themes, context files | 3074 |
| `/resume` | Session picker for the current project | 3094 |
| `/quit` | Shut down | 3099 |

Undocumented/hidden but dispatched: `/debug` (3079, dumps render/debug state), `/arminsayshi` (3084), `/dementedelves` (3089) — easter eggs (`components/armin.ts`, `components/daxnuts.ts`, `components/earendil-announcement.ts`).

Dynamic command sources merged into autocomplete at `interactive-mode.ts:634-731`:
- prompt templates → `/<name>` (with `argumentHint`)
- extension commands → `/<invocationName>` (with async `getArgumentCompletions`)
- skills → `/skill:<name>` (gated by `enableSkillCommands`)
- built-ins with argument completion: `/model` (fuzzy model list), `/thinking` (levels), `/login` (providers)
- `/llama` comes from a bundled hidden extension (`src/extensions/index.ts`, `src/extensions/llama/`)

## 1.3 Keyboard-driven features

Full id list + defaults: `/srv/pi/packages/coding-agent/docs/keybindings.md`; ids typed at `/srv/pi/packages/coding-agent/src/core/keybindings.ts:15-57`, definitions at `:93-238`. Wiring: `interactive-mode.ts:2849-2917` (`setupKeyHandlers`).

**App-level**
- `app.interrupt` (Esc) — abort streaming (restores queued messages to editor), cancel bash, exit bash mode; **double-Esc on empty editor** opens `/tree` or `/fork` per `doubleEscapeAction` (`interactive-mode.ts:2852-2878`)
- `app.clear` (Ctrl+C) clear editor / second press exits; `app.exit` (Ctrl+D) exit when empty; `app.suspend` (Ctrl+Z)
- `app.model.cycleForward` (Ctrl+P) / `cycleBackward` (Shift+Ctrl+P) — cycle scoped models
- `app.model.select` (Ctrl+L) — model picker; `app.models.save` (Ctrl+S) inside pickers
- `app.thinking.cycle` (Shift+Tab); `app.thinking.save` (Ctrl+S); `app.thinking.toggle` (Ctrl+T) collapse/expand thinking blocks
- `app.tools.expand` (Ctrl+O) — collapse/expand **all** tool output; also expands startup header
- `app.message.copy` (Ctrl+X); `app.message.followUp` (Alt+Enter) queue follow-up; `app.message.dequeue` (Alt+Up) restore queue to editor
- `app.editor.external` (Ctrl+G); `app.clipboard.pasteImage` (Ctrl+V / Alt+V)
- `app.session.new/tree/fork/resume` (no default keys)
- Session-picker keys: `togglePath` Ctrl+P, `toggleSort` Ctrl+S, `toggleNamedFilter` Ctrl+N, `rename` Ctrl+R, `delete` Ctrl+D, `deleteNoninvasive` Ctrl+Backspace
- Tree keys: `foldOrUp`/`unfoldOrDown` Ctrl+←/→, `editLabel` Shift+L, `toggleLabelTimestamp` Shift+T, filters `ctrl+d/t/u/l/a` + `ctrl+o` cycle
- Scoped-models keys: `enableAll` Ctrl+A, `clearAll` Ctrl+X, `toggleProvider` Ctrl+P, `reorderUp/Down` Alt+↑/↓

**Editor** (`tui.editor.*`, `tui.input.*`, `tui.select.*`): full emacs-ish cursor/word/line motion, kill ring (`yank` Ctrl+Y, `yankPop` Alt+Y), `undo`, jump-to-char (Ctrl+]), page up/down, `submit` Enter, `newLine` Shift+Enter/Ctrl+J, `tab` autocomplete, history browse at buffer edges + dedicated `historyPrevious/Next`.

**Fullscreen transcript** (`tui.altScreen.*`): page/half-page/line scroll, jump to previous/next prompt marker (OSC 133), transcript search with next/prev/close, top/bottom, "Jump to latest message" clickable label, mouse wheel/drag selection + copy-on-select, OSC 8 link clicks.

**Non-key input features**
- `@` → fuzzy project-file completion (`CombinedAutocompleteProvider`, `packages/tui/src/autocomplete.ts:278`); Tab → path completion
- `!command` runs bash and sends output to the model; `!!command` runs it excluded from context (`interactive-mode.ts:3105-3120`, `handleBashCommand` at 6504, rendered by `components/bash-execution.ts`). Editor border turns `bashMode` color while text starts with `!` (`onChange`, `interactive-mode.ts:2905-2911`)
- Image paste: `handleClipboardPaste` (`interactive-mode.ts:2934`) writes the clipboard image to a **temp file** and inserts the *file path* into the editor — the model then `read`s it. Same for drag-and-drop (terminal pastes the path). Only CLI `@file` args produce true inline `ImageContent` (`interactive-mode.ts:1113`, `src/cli/file-processor.ts`)
- Right-click paste (`handleRightClickPaste`, `interactive-mode.ts:2920`)

## 1.4 Footer / status bar contents

`/srv/pi/packages/coding-agent/src/modes/interactive/components/footer.ts:84-244` (`FooterComponent.render`):

- **Line 1**: cwd (`~`-shortened) + ` (git-branch)` + ` • session name`
- **Line 2 left**: `↑input ↓output Rcacheread Wcachewrite CH<hit-rate>% $cost[ (sub)] <ctx%>/<contextWindow>[ (auto)]` — context % colored `warning` >70%, `error` >90%; `(auto)` when auto-compaction on; `• xp` when `PI_EXPERIMENTAL`
- **Line 2 right**: `(provider) model-id • <thinking level>` (thinking shown only for reasoning models)
- **Line 3** (optional): all extension statuses from `ctx.ui.setStatus(key, text)`, alphabetically by key, space-joined, sanitized to one line

Extra data source for custom footers: `ReadonlyFooterDataProvider` (`src/core/footer-data-provider.ts`) exposing `getGitBranch()`, `getExtensionStatuses()`, `getAvailableProviderCount()`, `onBranchChange()`.

## 1.5 Dialogs / overlays

All built-in dialogs **replace the editor in place** via `showSelector` (`interactive-mode.ts:4529-4551`), not as floating modals. Only extension `ctx.ui.custom({overlay:true})` uses the real overlay stack.

| Component | File | Opened by |
|---|---|---|
| `SettingsSelectorComponent` | `components/settings-selector.ts` (945 ln) | `/settings` (`4554`) |
| `ModelSelectorComponent` | `components/model-selector.ts` | `/model`, Ctrl+L (`4987`) |
| `ScopedModelsSelectorComponent` | `components/scoped-models-selector.ts` | `/scoped-models` (`5024`) |
| `ThinkingSelectorComponent` | `components/thinking-selector.ts` | `/thinking` (`4817`) |
| `TreeSelectorComponent` | `components/tree-selector.ts` (1427 ln) | `/tree` (`5205`) |
| `SessionSelectorComponent` + `session-selector-search.ts` | `components/session-selector.ts` (1031 ln) | `/resume` (`5354`) |
| `UserMessageSelectorComponent` | `components/user-message-selector.ts` | `/fork` (`5146`) |
| `TrustSelectorComponent` | `components/trust-selector.ts` | `/trust` (`4962`), startup trust prompt |
| `OAuthSelectorComponent`, `LoginDialogComponent` | `components/oauth-selector.ts`, `login-dialog.ts` | `/login`, `/logout` (`5485`-`5968`) |
| `ThemeSelectorComponent`, `ShowImagesSelectorComponent`, `WarningSettingsSubmenu` | `components/theme-selector.ts`, `show-images-selector.ts`, `settings-selector.ts:132` | sub-menus of `/settings` |
| `FirstTimeSetupComponent` | `components/first-time-setup.ts` | first run (`src/cli/startup-ui.ts:196`), theme + analytics opt-in |
| `ConfigSelectorComponent` | `components/config-selector.ts` (942 ln) | `pi config` CLI, not interactive mode |
| `ExtensionSelectorComponent` / `ExtensionInputComponent` / `ExtensionEditorComponent` | `components/extension-*.ts` | `ctx.ui.select/confirm/input/editor` |
| `BorderedLoader` | `components/bordered-loader.ts` | `/share`, extension async work |

`/settings` menu items (`components/settings-selector.ts:462-830`): Auto-compact, Steering mode, Follow-up mode, Transport, HTTP idle timeout, Hide thinking, Mermaid diagrams, Cache miss notices, Collapse changelog, Quiet startup, Install telemetry, Default project trust, Double-escape action, Tree filter mode, Warnings (submenu), Default thinking level per model (submenu), TUI mode, Fullscreen exit output, Fullscreen scrollbar, Fullscreen copy on select, Theme (with light/dark auto submenu at `:323-370` and live preview), Show images, Image width, Auto-resize images, Block images, Skill commands, Show hardware cursor, Editor padding, Output padding, Autocomplete max items, Clear on shrink, Terminal progress.

## 1.6 Transcript rendering features

| Feature | Component |
|---|---|
| Markdown (headings, bold/italic/strike, lists, links, blockquotes, HR, code fences) + syntax highlighting | `packages/tui/src/components/markdown.ts`; theme via `getMarkdownTheme()` (`theme/theme.ts:1170`) |
| LaTeX symbol substitution in markdown | `packages/tui/src/latex.ts` |
| Mermaid diagrams rendered as ASCII art (`off`/`final`/`streaming`) | `components/mermaid.ts` via `grok-mermaid`, registered as a markdown transformer |
| Assistant message + thinking blocks (per-block collapse, `hideThinkingBlock`, custom hidden label, OSC 133 prompt markers) | `components/assistant-message.ts` |
| User message (bg-colored box, `outputPad`) | `components/user-message.ts` |
| Tool call/result boxes with pending/success/error backgrounds, **10-line collapsed preview** then expand | `components/tool-execution.ts:39,163`; `MouseRegion` click toggles (`:175`) |
| Custom tool renderers (`renderCall` / `renderResult`, `renderShell:"self"`) | `ToolRenderers` in `components/tool-execution.ts:24-33` |
| Word-level intra-line diffs, added/removed/context colors | `components/diff.ts` (`renderIntraLineDiff`) |
| Inline images (Kitty/iTerm2), auto PNG conversion, width in cells, `showImages` toggle | `components/tool-execution.ts:379-405`, `packages/tui/src/components/image.ts`, `terminal-image.ts` |
| Bash execution blocks (`!`) | `components/bash-execution.ts` |
| Compaction summary / branch summary entries | `components/compaction-summary-message.ts`, `branch-summary-message.ts` |
| Skill invocation entries | `components/skill-invocation-message.ts` |
| Extension custom messages / entries | `components/custom-message.ts`, `custom-entry.ts` |
| Status rows: working spinner, retry countdown, compaction, branch summarization, idle | `components/status-indicator.ts:7` (`StatusIndicatorKind`), `countdown-timer.ts` |
| Diagnostics notices (cache misses, dropped provider thinking blocks, project-trust warning) | `interactive-mode.ts:3816-3930` |

---

# 2. Extension system

Types: `/srv/pi/packages/coding-agent/src/core/extensions/types.ts` (1797 ln). Runner: `runner.ts` (1286 ln). Loader: `loader.ts` (809 ln). Docs: `/srv/pi/packages/coding-agent/docs/extensions.md` (3029 ln).

## 2.1 What an extension can register (`ExtensionAPI`, `types.ts:1252-1506`)

- **Events** `pi.on(...)` — 40 event types (`:1257-1301`): `project_trust`, `resources_discover`, `session_start`, `session_info_changed`, `session_before_switch/fork/compact/tree`, `session_compact`, `session_compact_failed`, `session_shutdown`, `session_tree`, `context`, `before_provider_request/headers`, `after_provider_response`, `before_agent_start`, `agent_start/end/settled`, **`ui_prompt_start`/`ui_prompt_end`**, `turn_start/end`, `message_start/update/end`, `tool_execution_start/update/end`, `model_select`, `thinking_level_select`, `tool_call`, `tool_result`, `user_bash`, `input`
- **Tools** `registerTool` (`:1308`) — `ToolDefinition` at `:451-501` including `renderCall`/`renderResult`/`renderShell`
- **Commands** `registerCommand(name, {description, getArgumentCompletions, handler})` (`:1317`, `RegisteredCommand` at `:1229`)
- **Shortcuts** `registerShortcut(KeyId, {description, handler})` (`:1320`) — appear in `/hotkeys`
- **CLI flags** `registerFlag` / `getFlag` (`:1329`, `:1345`)
- **Renderers**: `registerMessageRenderer(customType, MessageRenderer)` (`:1352`), `registerMarkdownTransformer(MarkdownTransformer)` (`:1355`), `registerEntryRenderer(customType, EntryRenderer)` (`:1358`). Types at `:1201-1223` — all three return a **TUI `Component`**
- **Actions**: `sendMessage`, `sendUserMessage`, `appendEntry`, `setSessionName`/`getSessionName`, `setLabel`, `exec`, `getActiveTools`/`getAllTools`/`setActiveTools`, `getCommands`, `setModel`, `get/setThinkingLevel`
- **Providers**: `registerProvider` / `unregisterProvider` (`:1486-1502`), incl. OAuth login flows and `streamSimple`
- **Event bus**: `pi.events` (`:1505`)
- **Session control** (command contexts only, `ExtensionCommandContext` `:355-389`): `newSession`, `fork`, `navigateTree`, `switchSession`, `reload`, `waitForIdle`

## 2.2 UI-facing API — `ExtensionUIContext` (`types.ts:133-284`)

TUI impl: `interactive-mode.ts:2423-2474`. RPC impl: `modes/rpc/rpc-mode.ts:136-311`. No-op impl: `core/extensions/runner.ts:236-268`.

**Declarative / data-driven — a web frontend can render these natively:**

| API | types.ts | TUI impl | RPC impl | Web mapping |
|---|---|---|---|---|
| `select(title, options[], {signal,timeout})` | `:135` | `:2425` → `showExtensionSelector` (`:2480`) | `rpc-mode.ts:137` → `extension_ui_request{method:"select"}` | list dialog; strings only |
| `confirm(title, message, opts)` | `:138` | `:2426` (implemented as `select` with Yes/No, `:2536`) | `:142` | yes/no modal |
| `input(title, placeholder, opts)` | `:141` | `:2427` → `:2556` | `:147` | single-line prompt |
| `editor(title, prefill)` | `:224` | `:2448` → `:2612` | `:254` | textarea modal (also supports handoff to `$EDITOR`) |
| `notify(message, "info"\|"warning"\|"error")` | `:144` | `:2428` → `:2734` (routes to status/warning/error rows) | `:152` | toast/inline notice |
| `setStatus(key, text\|undefined)` | `:150` | `:2430` | `:168` | status-bar chip keyed by extension. Text may contain ANSI |
| `setWidget(key, string[]\|undefined, {placement})` | `:172` | `:2440` | `:195` (string-array form only) | panel above/below composer. Lines may contain ANSI |
| `setTitle(title)` | `:195` | `:2443` (`terminal.setTitle`) | `:218` | `document.title` |
| `setEditorText(text)` / `getEditorText()` | `:218`, `:221` | `:2446`, `:2447` | `:238` (set only; get returns `""`) | composer value |
| `pasteToEditor(text)` | `:215` | `:2445` (injects bracketed-paste sequence) | `:233` (falls back to `setEditorText`) | paste-with-collapse semantics |
| `setWorkingMessage(msg?)` | `:153` | `:2431` | no-op | spinner label |
| `setWorkingVisible(bool)` | `:156` | `:2437` | no-op | show/hide spinner row |
| `setWorkingIndicator({frames[], intervalMs})` | `:166` | `:2438` | no-op | custom animation frames (**raw ANSI strings**) |
| `setHiddenThinkingLabel(label?)` | `:169` | `:2439` | no-op | label for collapsed thinking |
| `getToolsExpanded()` / `setToolsExpanded(b)` | `:280`, `:283` | `:2472`, `:2473` | stub `false` | global expand toggle |
| `theme` (readonly), `getAllThemes()`, `getTheme(name)`, `setTheme(name\|Theme)` | `:268-277` | `:2455-2471` | partial (`getAllThemes` → `[]`, `setTheme` fails) | see §3 |

**Component-handing / terminal-only — cannot be rendered by a non-terminal frontend:**

| API | types.ts | TUI impl | What it hands over |
|---|---|---|---|
| `custom<T>(factory(tui, theme, keybindings, done), {overlay, overlayOptions, onHandle})` | `:198-212` | `interactive-mode.ts:2444` → `showExtensionCustom` (`:2745`) | A live `Component` with `render(width): string[]`, `handleInput(data)`, `handleMouse`, `invalidate()`. RPC returns `undefined as never` (`rpc-mode.ts:228`) |
| `setWidget(key, (tui, theme) => Component, opts)` | `:173-177` | `:2440` | Component factory overload. RPC silently ignores factories (`rpc-mode.ts:196-207`) |
| `setFooter((tui, theme, footerData) => Component)` | `:185-189` | `:2441` | RPC no-op (`:210`) |
| `setHeader((tui, theme) => Component)` | `:192` | `:2442` | RPC no-op (`:214`) |
| `setEditorComponent(EditorFactory)` / `getEditorComponent()` | `:262`, `:265` | `:2453`, `:2454` | `EditorFactory = (tui, theme: EditorTheme, keybindings) => EditorComponent` (`types.ts:127`). RPC no-op (`:277`) |
| `addAutocompleteProvider((current) => AutocompleteProvider)` | `:227` | `:2449` | Provider interface itself is data-shaped (`packages/tui/src/autocomplete.ts:246-275`: `getSuggestions`, `applyCompletion`, `shouldTriggerFileCompletion`) — **portable**, but it is wired into the TUI editor. RPC no-op (`:273`) |
| `onTerminalInput(handler)` | `:147` | `:2429` | Raw escape-sequence stream. RPC returns an empty unsubscribe (`:163`) |
| `registerMessageRenderer` / `registerEntryRenderer` / tool `renderCall`/`renderResult` | `:1352-1358`, `:493-501` | transcript components | Return `Component` objects |

`ui_prompt_start` / `ui_prompt_end` events are emitted around `select`/`confirm`/`input`/`editor`/`custom` by `runner.ts:441-487` (`wrapUIPromptContext`, `withUIPrompt`) — useful for a web shell to know a modal is open.

Guard flags for extension authors: `ctx.mode: "tui" | "rpc" | "json" | "print"` and `ctx.hasUI` (`types.ts:313-315`).

## 2.3 Mapping strategy for a web frontend

1. **Reuse the RPC protocol as the contract**: `docs/rpc.md:1184-1375` already defines `extension_ui_request` / `extension_ui_response` for `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` (types at `src/modes/rpc/rpc-types.ts:245-290`). That is the sanctioned declarative surface. Everything else in RPC mode is a documented no-op — a web GUI that ships only these will match RPC parity exactly, but will lose `custom()`, `setFooter`, `setHeader`, `setEditorComponent`, `setWorkingIndicator`, `setHiddenThinkingLabel`, `onTerminalInput`, theme switching, and tool-expansion control.
2. **To exceed RPC parity you need a component bridge.** Two viable paths already exist in-tree:
   - **ANSI→HTML**: call `component.render(width)` and convert the ANSI lines. Precedent: `src/core/export-html/tool-renderer.ts:58-172` (`createToolHtmlRenderer`) + `src/core/export-html/ansi-to-html.ts`. This works for `setWidget`/`setFooter`/`setHeader`/message+entry renderers/tool renderers (static-ish output), but has **no input path** — good for read-only surfaces.
   - **Real terminal in the browser**: run the whole `Component` in a headless/embedded terminal and pipe to xterm.js. See §5.
3. **Statuses, widget lines and working-indicator frames contain raw ANSI/SGR** (docs explicitly say custom frames are "rendered verbatim" — `docs/tui.md:806`). Any web renderer must run them through an ANSI→HTML converter, not `textContent`.
4. `setWidget` string-array form and `setStatus` are the two extension surfaces already proven to work outside a terminal (RPC forwards them) — prioritise those in a web GUI and encourage extension authors toward them.

---

# 3. Themes

**Definition**: JSON. Built-ins `/srv/pi/packages/coding-agent/src/modes/interactive/theme/dark.json` and `light.json`. Schema: `theme/theme-schema.json` (JSON Schema draft-07, publicly referenced by `$schema` URL). Runtime validation: `theme/theme-json.ts:103` (`validateThemeJson`, TypeBox). Loader/Theme class: `theme/theme.ts:282` (`class Theme`, `fg()` `:323`, `bg()` `:329`, `bold/italic/underline/inverse/strikethrough` `:335-351`). Hot-reload watcher + controller: `theme/theme-controller.ts`.

**Shape**: `{ $schema, name, vars?: Record<string, hex|0-255>, colors: Record<token, hex|0-255|varName|"">, export?: { pageBg, cardBg, infoBg } }`. `""` = terminal default color. `dark.json` defines **56 tokens** (docs say "53 required" + 3 optional fallbacks: `thinkingMax`→`thinkingXhigh`, `searchMatchBg`→`selectedBg`, `searchMatchText`→`text`).

**Token groups** (`docs/themes.md:168-277`, enum at `theme/theme.ts:41-90`):
- Core UI (13): `accent, border, borderAccent, borderMuted, success, error, warning, muted, dim, text, thinkingText, scrollbarTrack, scrollbarThumb`
- Backgrounds/content: `selectedBg, searchMatchBg, searchMatchText, userMessageBg, userMessageText, customMessageBg, customMessageText, customMessageLabel, toolPendingBg, toolSuccessBg, toolErrorBg, toolTitle, toolOutput`
- Markdown (10): `mdHeading, mdLink, mdLinkUrl, mdCode, mdCodeBlock, mdCodeBlockBorder, mdQuote, mdQuoteBorder, mdHr, mdListBullet`
- Diffs (3): `toolDiffAdded, toolDiffRemoved, toolDiffContext`
- Syntax (9): `syntaxComment, syntaxKeyword, syntaxFunction, syntaxVariable, syntaxString, syntaxNumber, syntaxType, syntaxOperator, syntaxPunctuation`
- Thinking borders (7): `thinkingOff, thinkingMinimal, thinkingLow, thinkingMedium, thinkingHigh, thinkingXhigh, thinkingMax`
- Bash mode (1): `bashMode`
- Optional `export` section for HTML output

**Reusable for a web theme — yes, and there is already a working precedent.** `theme/theme.ts:962` `getResolvedThemeColors(themeName?): Record<string,string>` resolves vars, converts 256-color indices to hex (`ansi256ToHex`, `:914-956`) and substitutes a sensible default for `""`. `theme/theme.ts:997` `getThemeExportColors()` returns the optional export bgs. `src/core/export-html/index.ts:120-176` (`generateThemeVars` / `generateHtml`) injects these as CSS custom properties into `template.css` (1066 ln) for `/export` HTML. A web GUI can call the same two functions and get a complete CSS variable set for any installed theme.

Theme discovery locations: built-in `dark`/`light`, `~/.pi/agent/themes/*.json`, `.pi/themes/*.json` (trusted projects), package `themes/` or `pi.themes`, `themes` settings array, `--theme <path>`. Selection via `theme` setting; `"light/dark"` syntax follows terminal appearance; `--use-theme` overrides for one run.

---

# 4. Skills, prompt templates, settings (GUI-editable formats)

## Skills (`docs/skills.md`)
- Locations: `~/.pi/agent/skills/`, `~/.agents/skills/`, `.pi/skills/`, `.agents/skills/` (cwd + ancestors up to git root; trusted projects only), package `skills/` or `pi.skills`, `skills` settings array, `--skill <path>`
- Format: directory containing `SKILL.md` with YAML frontmatter `name` + `description` (Agent Skills standard); freeform `scripts/`, `references/`, `assets/`. Root `.md` files with valid skill frontmatter are also accepted in `~/.pi/agent/skills/` and `.pi/skills/`
- Fixtures showing every validation case: `packages/coding-agent/test/fixtures/skills/*/SKILL.md`
- Exposed as `/skill:<name>` when `enableSkillCommands` is true

## Prompt templates (`docs/prompt-templates.md`)
- Locations: `~/.pi/agent/prompts/*.md`, `.pi/prompts/*.md`, package `prompts/` or `pi.prompts`, `prompts` settings array, `--prompt-template <path>`. **Non-recursive** discovery
- Format: Markdown, optional frontmatter `description` and `argument-hint`; filename = command name
- Substitutions: `$1..$n`, `$@`/`$ARGUMENTS`, `${1:-default}`, `${@:-default}`, `${@:N}`, `${@:N:L}`
- Live examples in this repo: `/srv/pi/.pi/prompts/{cl,deslop,is,pr,sa,wr}.md`

## settings.json (`docs/settings.md`)
- `~/.pi/agent/settings.json` (global) and `.pi/settings.json` (project). Project overrides global with **recursive object merge** (`src/core/settings-manager.ts:169-176`, `deepMergeSettings`)
- **There is no JSON Schema file for settings** (only `theme-schema.json` exists). The authoritative shape is the TypeScript `Settings` interface at `/srv/pi/packages/coding-agent/src/core/settings-manager.ts:95-147` — a GUI editor should generate its form from that plus the tables in `docs/settings.md:24-322`
- Related sibling files a GUI would likely also edit: `~/.pi/agent/keybindings.json` (ids from `src/core/keybindings.ts`), `~/.pi/agent/models.json` (`docs/models.md`), `~/.pi/agent/trust.json`, `~/.pi/agent/themes/*.json`
- Resource path arrays (`extensions`, `skills`, `prompts`, `themes`) support globs, `!exclude`, `+force-include`, `-force-exclude`; paths resolve relative to the settings file's directory
- `packages` accepts string sources or `{source, skills[], extensions[], prompts[], themes[]}` filter objects

---

# 5. `packages/tui`: is it abstracted enough for xterm.js in a browser?

**Yes — the abstraction already exists and is already exercised by a headless xterm.js implementation.**

## Terminal I/O abstraction
`/srv/pi/packages/tui/src/terminal.ts:69-110` defines the entire I/O surface:

```ts
export interface Terminal {
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
  drainInput(maxMs?: number, idleMs?: number): Promise<void>;
  write(data: string): void;
  get columns(): number; get rows(): number;
  get kittyProtocolActive(): boolean;
  moveBy(lines: number): void;
  hideCursor(): void; showCursor(): void;
  clearLine(): void; clearFromCursor(): void; clearScreen(): void;
  setTitle(title: string): void;
  setProgress(active: boolean): void;
}
```

- `ProcessTerminal implements Terminal` — `terminal.ts:137` — the only place `process.stdin/stdout` is touched
- `VirtualTerminal implements Terminal` — `/srv/pi/packages/tui/test/virtual-terminal.ts:11` — **backed by `@xterm/headless`**, with `sendInput(data)` and `resize(cols, rows)` test hooks. This is the existence proof: the whole TUI already runs against xterm.
- `TuiBase` takes the terminal by constructor injection: `packages/tui/src/tui.ts:499` `constructor(terminal: Terminal, showHardwareCursor?, logDirectory?)`. `TuiMainScreen` (`tui-main-screen.ts:124`) and `TuiAltScreen` (`tui-alt-screen.ts:195`) both do.

## Injection point in the coding agent
`/srv/pi/packages/coding-agent/src/modes/interactive/tui-renderer.ts:8-48` — `InteractiveTuiOptions.terminal?: Terminal` (`:12`) and `const terminal = options.terminal ?? new ProcessTerminal()` (`:22`). So `createInteractiveTui({ terminal: myBrowserTerminal, tuiMode: "fullscreen", ... })` is a supported, already-tested path (`packages/coding-agent/test/interactive-tui.test.ts:53-340`). `createInteractiveTuiReference` (`:51-79`) is a Proxy that keeps a stable `TUI` handle across renderer swaps.

## Browser portability of the rendering layer
`packages/tui/package.json` runtime deps are only `get-east-asian-width` and `marked` (`@xterm/headless` and `chalk` are devDependencies). Node built-ins appear in exactly five source files:

| File | Node usage | Blocking? |
|---|---|---|
| `src/terminal.ts` | `node:fs`, `node:path` | Only in `ProcessTerminal` — replace it |
| `src/tui-main-screen.ts:1-3` | `node:fs/os/path` | **Only debug + crash logging** (`:324-327`, `:519-530`, `:571-595`) — trivially shimmable |
| `src/terminal-image.ts:1-3` | `execSync`, `homedir`, `isAbsolute` | Terminal image-protocol capability detection — stub it |
| `src/native-platform.ts`, `src/native-module-path.ts` | `node:path` | Native clipboard/modifier prebuilds — stub it |

Everything else — `Component`, `Container`, `Text`, `Box`, `Markdown`, `SelectList`, `SettingsList`, `Editor`, `Input`, `ScrollView`, `VStack`/`HStack`, `MouseRegion`, layout, keys, fuzzy, latex, wrap/truncate — is pure string→`string[]` ANSI computation with no I/O.

## What that buys you, and the caveats
- **Viable fallback**: mount xterm.js in a `<div>`, implement `Terminal` over it (`write` → `term.write`, `onInput` ← `term.onData`, `columns/rows` ← `term.cols/rows`, `onResize` ← `FitAddon`), pass it to `createInteractiveTui`. Extension `ctx.ui.custom()` components, custom editors, custom footers/headers, and component-factory widgets then all work unmodified, including overlays and mouse.
- **Caveats**:
  - `kittyProtocolActive` and the Kitty keyboard-protocol negotiation (`terminal.ts:14-30`) affect which modifier combos are distinguishable; xterm.js does not implement the Kitty keyboard protocol, so `super+*` bindings and key-release events (`wantsKeyRelease`) degrade. `VirtualTerminal` cheats by returning `true` unconditionally (`virtual-terminal.ts:62`).
  - Inline images use Kitty/iTerm2 graphics protocols (`packages/tui/src/terminal-image.ts`, `components/image.ts`); xterm.js needs an image addon or a fallback to text placeholders.
  - Clipboard goes through native prebuilds (`packages/tui/native/*`) and OSC 52; you'd map to the browser Clipboard API.
  - `fullscreen` mode is the right target (app-owned viewport, no reliance on terminal scrollback); `regular` mode assumes terminal-owned scrollback.
  - `PI_TUI_WRITE_LOG` captures the raw ANSI stream (`docs/tui.md:488-494`) — handy for debugging the bridge.
- **Recommended architecture**: render the *first-class* surfaces (transcript, composer, footer, built-in dialogs, declarative extension UI) as real DOM using the theme-as-CSS-variables path from §3 and the RPC-style declarative protocol from §2.3; keep an xterm.js pane as the escape hatch for `ctx.ui.custom()`, `setEditorComponent`, and component-factory `setWidget`/`setFooter`/`setHeader`, plus `registerMessageRenderer`/`renderResult` output that has no declarative equivalent.
