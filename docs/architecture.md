# Architecture

*English summary of the original design notes ([ARCHITEKTUR.md](ARCHITEKTUR.md), German, 2026-09-09)
and of what has been built since. The research that led here is in [`docs/research/`](research/).*

## The constraint that shapes everything

[pi](https://github.com/earendil-works/pi) moves fast. At the time of the decision its main
branch had ~90 commits per week, a tagged release roughly every three days, and about 40
releases with a "Breaking Changes" section in the changelog. Any GUI that patches pi's
internals — or reads its private modules — signs up for permanent breakage.

So the hard requirement is: **be additive**. pi stays an unmodified, exactly-pinned npm
dependency, and Pi Viewer touches only surfaces pi declares supported.

## The three seams to pi

1. **RPC mode** (`pi --mode rpc`) — JSON lines over stdin/stdout, documented and tested by
   upstream. Covers prompting, steering, follow-ups, abort, queues, model and thinking level,
   compaction, retry, fork, clone, entries and tree reads, statistics, HTML export, the
   command list, and the extension-dialog subprotocol (`extension_ui_request`/`_response`).
2. **SDK** (the package's root import) — used sparingly, for what RPC does not carry: the
   session list, provider login/logout with interactive auth flows, settings and package
   management, project trust. Everything SDK-touching lives in **one file**,
   `packages/host/src/pi-sdk.ts`, so an upstream change has one place to land.
3. **A pi extension** (`packages/pi-extension`) — written against pi's public extension API.
   It adds what neither RPC nor SDK provide: tool approvals via the `tool_call` hook,
   in-session tree navigation, and tool management, all reachable over RPC as slash commands.
   Its replies travel through a reserved status key rather than session entries, so merely
   opening a session never writes to its file.

Deliberately **not** used: pi's experimental server/protocol packages (a future multi-frontend
architecture, explicitly without compatibility guarantees and not part of the npm package).
When that stabilizes, adopting it is a transport swap inside the host — the client's contract
would not change.

## Shape

```
Browser / Tauri window
   │  WebSocket — plain-JSON protocol, sequence numbers, snapshot + replay
   ▼
Host (Node)
   ├── one child process per session:  pi --mode rpc  ─ loads ─▶  Tau extension
   ├── pi-sdk.ts  (the single SDK adapter file)
   └── PTYs: shells and pi's own TUI, owned by the host, surviving page reloads
```

- **The client knows only the Tau protocol** (`packages/shared`) — plain JSON, no pi types.
  The same client runs in a browser against a remote host and inside the Tauri window against
  a local one.
- **The host owns the sessions.** Processes keep running while browsers come and go; an idle
  timeout reaps them. Every session change is a sequenced event; reconnecting clients replay
  from their last sequence number or receive a fresh snapshot.
- **Session files stay 100 % pi's.** JSONL under `~/.pi/agent/sessions/`, never tailed, never
  written to by the viewer; history is read through pi (`get_entries`) or, for the instant
  preview on open, parsed read-only from the file.

## Why not build on an existing pi GUI

Four open-source candidates were evaluated in depth (see `docs/research/1*.md`). All four bind
pi's SDK in-process, none uses Tauri, none virtualizes long transcripts, and each is missing
pieces of pi's surface (approvals above all). Building additively over RPC keeps exactly one
narrow, versioned seam — in our own hands — at the cost of more initial work. Selected
MIT-licensed ideas from those projects informed the design (event conflation, sequence replay,
the extension-UI bridge).

## Performance decisions that matter

- **Opening a session never waits for pi.** The host answers a preview straight from the
  session file (milliseconds); the pi process (~450 ms of startup) attaches behind it.
- **Switching sessions keeps the expensive parts alive**: the terminal panel is never
  remounted, and the last three transcripts stay mounted and stacked, only the visible one
  shown.
- **The transcript is virtualized** (TanStack Virtual), streaming deltas are conflated per
  animation frame, code highlighting (shiki) is cached, markdown never re-parses per token.

## Stack

| Layer | Choice |
|---|---|
| UI | React 19, TypeScript, Vite, Tailwind 4, Radix, lucide |
| State | zustand |
| Transcript | TanStack Virtual, shiki (lazy grammars), react-markdown |
| Terminal | xterm.js in the client, node-pty in the host |
| Host | Node ≥ 22, Hono, ws |
| Desktop | Tauri 2, Node sidecar (see [desktop.md](desktop.md)) |
| Tests | Vitest, Playwright, Biome |

## Known limits

- xterm.js does not answer pi's Kitty keyboard protocol, so terminal keys that strictly need
  it (e.g. Shift+Enter as distinct from Enter inside pi's TUI tab) are not distinguishable;
  terminal inline images are not supported.
- pi has no permission system of its own; approvals exist purely because the Tau extension
  intercepts `tool_call`. Anything talking to pi outside the extension is unrestricted.

## Risks and how they are held

- *pi breaks RPC or the SDK in a minor release* — the seam is small, an integrity test pins
  the expected exports and event shapes, and the version is only ever bumped deliberately;
  see [upstream.md](upstream.md).
- *Long sessions get slow* — virtualization and conflation were built first, not retrofitted.
