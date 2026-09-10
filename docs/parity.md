# Parity with pi

*What pi offers in its TUI/CLI, and how Pi Viewer covers it. English summary of the running
ledger in [PARITAET.md](PARITAET.md) (German), which also records the reasoning per decision.*

The baseline: everything you can **do** or **configure** in pi's own terminal UI is possible
in the GUI, with a short list of deliberate exceptions at the end.

## Doing things

| pi | Pi Viewer | Notes |
|---|---|---|
| Prompting, steering, follow-up queues | composer | queued entries can be edited or removed one by one |
| Images | attach, paste or drop into the composer | |
| Slash commands, skills, prompts | `/` menu in the composer, browsable dialog | unknown commands pass through to pi, so extension commands resolve |
| `@` file references | fuzzy project-file search in the composer | inserts the path only, as pi does |
| Tool approvals | four modes: Auto · Accept edits · Manual · Strict | provided by the Tau extension (`tool_call` hook), with dangerous-command patterns for shell calls; per-call or per-session allowance |
| `/tree` | session tree dialog | offers only points where nothing is half done: before a user message, at a branch end, or at a clean point inside an answer — a tool call is never cut off from its result (pi fills such cuts with synthetic errors) |
| `/fork`, `/clone` | fork dialog, clone action | |
| `/compact` | compact dialog, optional custom instructions | branch summaries on tree switches too |
| Model, thinking level | selectors in the composer | levels shown as labels (Off … XHigh), raw values on the wire |
| `!` shell commands | **intentionally not in the composer** | a shell belongs in the terminal panel; the host command remains for pi and tests |
| Terminal | real PTYs in a dock: shells and **pi's own TUI in a tab** | terminals are owned by the host and survive reloads and session switches |
| `/export` | Export menu: HTML and JSONL as browser downloads | nothing is written on the host machine; repeated clicks within 5 s are ignored silently |
| `/copy` | `/copy` | |
| Statistics | footer (context %, tokens, cost) plus a details popover | |
| Session search | **beyond pi**: Ctrl+F searches every entry including abandoned branches and pre-compaction history, highlights all occurrences, counts and walks them | pi's TUI has no session-wide search |

## Configuring things

| pi | Pi Viewer |
|---|---|
| Provider logins (API key, OAuth, device codes) | providers dialog driving pi's own auth flows |
| `settings.json`, `models.json`, `keybindings.json` | typed settings form (~29 keys) with a raw-JSON "Advanced" tab, global or per-project scope |
| Packages (`pi install …`) | package dialog: install, remove, update, per-source |
| Skills / prompts / extensions on and off | resources toggles |
| Project trust | trust banner on first contact, revisable in the configuration dialog |
| Session start options (system prompt, tool allow-list, extra extensions, ephemeral, …) | "Advanced" section of the new-session dialog |
| Tools on/off per session | tools dialog; tools whose OS cannot run them (e.g. `powershell` off Windows) are not offered, and a tool missing only a program (ripgrep for `grep`, fd for `find`) stays listed and offers to install it via the host's package manager |

## Deliberately open

| Feature | Why |
|---|---|
| `/share` | uploads the session to a third-party service (GitHub gist); needs a token and a decision we did not want to make for the user |
| Custom keybindings for the web UI | pi's `keybindings.json` applies to its terminal; the web UI ships fixed shortcuts (see `?`) |
| Editing tree labels | pi's RPC mode has no command for it; labels are shown read-only |
| ~14 terminal-only settings | meaningless in a browser |
| Terminal-component extension UIs | pi extensions that render custom *terminal* components get the xterm.js tab as their venue, not native HTML |
