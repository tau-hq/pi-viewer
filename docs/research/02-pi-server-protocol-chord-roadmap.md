<!-- Erkundungsbericht, 2026-09-09, Grundlage: /srv/pi @ ce5ec9ca3 (Pi 0.85.1) bzw. flache Klone im Scratchpad. Englisch belassen. -->

I have a complete picture. Here is the report.

---

# Architecture report: pi's remote/GUI story

## Executive summary

There are **three** distinct client/server stacks in this repo, at very different maturity levels. Only one is supported today, and it is not the one implied by `PI_EXPERIMENTAL=1 ./pi-test.sh server`:

| Stack | Transport | Status | Fit for a web GUI |
|---|---|---|---|
| **stdio RPC mode** (`pi --mode rpc`) | JSONL over stdin/stdout | **Supported, documented, shipped** (`packages/coding-agent/docs/rpc.md`, 1618 lines) | Highest coverage *today*; needs your own process host + WS bridge |
| **protocol/client/server + chord** | framed CBOR over Unix socket, or WebSocket via "Radius relay" | Experimental, source-only, **not published** | The intended long-term architecture; service contracts still thin |
| **`mini`** (`packages/coding-agent/src/experimental/mini/`) | NDJSON over Unix socket + child-process pipes | Throwaway spike to learn RPC requirements | Reference design only |

`packages/web-ui` **does not exist** — it was removed in commit `b141e1fa2` ("chore: remove web-ui workspace"). The pre-commit hook reference at `/srv/pi/.husky/pre-commit:22` is a leftover/forward-looking path glob.

---

## 1. `packages/protocol`

**Serialization: CBOR, not JSON or msgpack.** Custom encoder/decoder in `/srv/pi/packages/protocol/src/cbor/` (encoder 216 lines, decoder 168 lines). Framing is 4-byte unsigned big-endian length prefix + one definite-length CBOR item (`/srv/pi/packages/protocol/src/framing.ts:27-38`). Default limits: 16 MiB per frame (`framing.ts:6`), 1,000,000 array/map entries, 64 nesting levels (`cbor/options.ts`).

**The protocol is deliberately tiny — it is a routing envelope, not an application protocol.** All message kinds, from `/srv/pi/packages/protocol/src/protocol.ts`:

Client → server (3 kinds, `protocol.ts:62`):
- `hello` `{ type, version }` — must be the first frame (`protocol.ts:30-33`)
- `request` `{ type, id, target, call }` — `call` is an **opaque strict-JSON payload** (`protocol.ts:50-55`)
- `cancel` `{ type, id, target }` (`protocol.ts:56-59`)

Server → client (5 kinds, `protocol.ts:96`):
- `hello` `{ type, version, serverId }` (`protocol.ts:65`)
- `hello_error` `{ type, error }` (`protocol.ts:70`)
- `response` `{ type, id, ok: true, result? }` | `{ type, id, ok: false, error }` (`protocol.ts:74-86`)
- `service_update` `{ type, subscriptionId, update }` (`protocol.ts:87`)
- `attachment` `{ type, attachment: SessionTarget | null }` — out-of-band route change (`protocol.ts:92-95`)

**Routing targets** (`protocol.ts:36-46`): a server target is `{ serverId }`; a session target is `{ serverId, sessionId, attachmentId }`. `serverId` must be a canonical lowercase UUIDv4 (regex at `protocol.ts:13`).

**Versioning: `PROTOCOL_VERSION = 8`** (`protocol.ts:5`). There is **no negotiation** — `isSupportedProtocolVersion()` is exact equality (`/srv/pi/packages/protocol/src/codec.ts:139-141`). Version has been bumped 8 times without compatibility guarantees ("The protocol is experimental and has no compatibility guarantees", README last line).

**Does it cover what the TUI needs? Not in this package — by design.** `pi-protocol` validates only that payloads are strict JSON; it explicitly does *not* know sessions, streaming, tool calls, models, or commands. Those live as **Chord service contracts** in `/srv/pi/packages/coding-agent/src/experimental/services/`:

| Contract | File | Covers |
|---|---|---|
| `pi.session-directory` | `services/sessions.ts:24` | replicated `{ revision, sessions[] }` |
| `pi.session-management` | `services/sessions.ts:34` | `create`/`remove`/`attach`/`detach` |
| `pi.models` | `services/models.ts:35` | replicated catalog + `select`, `selectThinking`, `cycleThinking`, `refresh` |
| `pi.agent-controller` | `services/agent-controller.ts:54` | `prompt`, `steer`, `followUp`, `nextRun`, `cancelQueued`, `requestAbort`, `resume`, `compact`, `navigate` |
| `pi.transcript` | `services/transcript.ts:15` | replicated `{ snapshot: LaneTranscriptSnapshot, event: LaneWatchEvent }` |
| `pi.presentation-plugins` / `pi.session-plugins` | `services/plugins.ts:12,19` | plugin build/reload |
| `pi.local.slash-commands` | `services/slash-commands.ts:30` | **`{ local: true }` — process-local, never crosses the wire** |
| `pi.local.presentation-ui` | `services/presentation-ui.ts:20` | **also `{ local: true }`** |

**Coverage gaps that matter for a GUI:**
- **Streaming: covered.** `TranscriptState.snapshot` is a `LaneSnapshot` (`/srv/pi/packages/agent/src/harness/agent-harness.ts:228-248`) containing `operation.streamingMessage`, `operation.runningTools`, `retry`, `deferred`, `queues`, `stats`. It replicates through Chord delta ops, so a token append is one `["a", path, delta]` op, not a full resend.
- **Tool calls: covered** via `LaneSnapshotTool` inside the same snapshot.
- **Approvals: entirely absent.** `grep -rn "approval\|permission" packages/coding-agent/src/experimental` returns **zero hits**. Pi has no permission system at all (README.md:38). Approval-shaped UX exists only as extension-authored `ctx.ui.confirm()` dialogs, which the experimental stack cannot carry.
- **Extension UI: absent.** `PresentationUI` is local-only with just `select()` and `showStatus()`. The rich question/diff-review dialog services are **design docs only** (`packages/agent/docs/plugins.md` §"Session-owned deferred interactions", line 690+).
- **Slash commands: absent over the wire.** Being `local: true`, they are registered by presentation-side facets loaded from server-built bundles, not enumerated over RPC.
- **Model switching: covered** (`pi.models`).

---

## 2. `packages/server`

**Transport: Unix domain socket only** in this package (`/srv/pi/packages/server/src/transports/unix/listener.ts` — the only `createServer`/`listen` in the package). `Server` itself is transport-agnostic through `ServerListener` (`/srv/pi/packages/server/src/listener.ts:3-8`), which just supplies `ByteConnection`s.

Socket hardening (`transports/unix/listener.ts`): directory created `0o700` (line 53), socket mode defaults `0o600` (line 11), bound to a temp path then hard-linked into place to avoid races (lines 72-80), stale-socket probing before rebinding.

**Auth: none.** `grep` for auth/token/credential across `packages/server/src` and `packages/client/src` returns only comments (`listener.ts:3` "after any required transport authentication"; `connection.ts:6` "An established, authorized ordered byte connection"). The protocol README states outright: *"Peer authentication and authenticated service contexts are not implemented by the experimental transport."* Auth is delegated:
- **Unix**: filesystem permissions only.
- **Radius relay**: bearer token at the WebSocket gateway (see §6).

The services README lists "add authenticated per-client projection when identity lands" and "add authenticated workspace authorization" as open continuation points.

**Concurrency: multi-client, multi-session, multi-attachment, with no hard caps.** `Server` holds `connections: Set<ConnectionState>` (`server.ts:57`). `SessionRouter` (`/srv/pi/packages/server/src/session-router.ts:34-40`) holds `hostedSessions: Map`, `attachmentsByClient: Map`, and each `HostedSession` has `attachments: Set<ClientAttachment>` — so **N presentations can attach to one session simultaneously**. Only per-connection backpressure is bounded (`listener.ts:218`, "Unix connection exceeded its pending byte limit"). Handshake timeout 5 s (`server.ts:41`).

**How it's started.** `PI_EXPERIMENTAL=1 ./pi-test.sh server` → `packages/coding-agent/src/experimental/cli.ts` → `commands.ts:10 runServerCommand` → `startForegroundServer()` in `/srv/pi/packages/coding-agent/src/experimental/server.ts`. It locks a logical `serverId` in `~/.pi/server` via `proper-lockfile` (`server.ts:83-120`), stores a `default-server-id` file, sockets at `~/.pi/server/<serverId>.sock`, sessions at `~/.pi/agent/experimental/sessions`. Clients auto-activate a server if discovery finds none (`client-runtime.ts:80-88`).

**Maturity.** README is thorough; CHANGELOG goes back to 0.80.3 and shows real breaking-change discipline. Tests: `conformance.test.ts` (502 lines), `protocol.test.ts` (168), `unix.test.ts` (143), `server.test.ts` (127) — 1057 lines total. Almost no TODOs (only `TODO_CONTEXT`, a placeholder invocation context from Chord). **But it is not published to npm as part of the product**: `pi-client`/`pi-protocol`/`pi-server` are **devDependencies** of coding-agent, and `dist/experimental` + `dist/cli/experimental` are excluded from `files`. The coding-agent CHANGELOG entry for 0.85.1 makes this explicit:

> "Fixed SDK import failures caused by unintentionally publishing internal experimental code and dependencies in 0.85.0. The experimental `client` and `experimental/plugin` subpaths and server/client commands are now **source-only through `pi-test.sh`**."

**Relationship to the coding agent: the stable TUI does not use it.** `grep -rn "pi-client|pi-protocol|pi-server" packages/coding-agent/src/modes packages/coding-agent/src/core` returns **nothing**. The production interactive TUI runs the agent in-process. Only `packages/coding-agent/src/experimental/client-tui.ts` is remote.

---

## 3. `packages/client`

**It is a library** — a transport-neutral protocol client (`/srv/pi/packages/client/src/client.ts`, 479 lines), not a TUI. Public API (`src/index.ts`): `Client`, `createClientServiceTransport`, plus `ByteTransport`/`ByteTransportFactory` types.

**This is the single most important fact for your web GUI:** the client is defined against an abstract byte transport, and the README says so directly:

> ```ts
> const transportFactory: ByteTransportFactory = async (handlers) => {
>   // Connect using WebSocket, Unix socket, or another ordered byte transport.
> ```

`ByteTransportFactory = (handlers) => ByteTransport | Promise<ByteTransport>` with `send(chunk: Uint8Array)` / `close()` and `onData`/`onClose`/`onError` (`/srv/pi/packages/client/src/transport.ts:1-18`). **`packages/client/src` has zero `node:` imports outside `unix.ts`**, which is a separate `./unix` export. Same for `packages/protocol/src` — **zero `node:` imports anywhere**. So `Client` + `pi-protocol` run in a browser today, given a WebSocket-backed `ByteTransport`.

Client API surface (`client.ts`): `connect()`, `reconnect()`, `disconnect()`, `request(target, call, signal)`, `subscribeService()`, `serviceCatalogue()`, `onConnectionStateChange()`, `onAttachmentChange()`, `dispose()`. No automatic reconnect or request replay (README: *"It never reconnects or replays requests automatically"*).

**Is the TUI decoupled from the agent process? Yes — but only the experimental TUI.** `/srv/pi/packages/coding-agent/src/experimental/client-tui.ts` (804 lines) is a full alt-screen TUI that owns *no* agent state: it builds a Chord `FacetHost`, binds `SessionDirectory`/`SessionManagement`/`PresentationPlugins` to the server and `Models`/`AgentController`/`Transcript`/`SessionPlugins` to the attached session (see `client-runtime.ts:33-40`), and renders `TranscriptState.snapshot`. It reuses stable TUI components (`chat-viewport.ts`, `CustomEditor`, theme controller) — the decoupling is real and already proven. **A web GUI is architecturally the same exercise with a different presentation facet.**

---

## 4. `packages/chord`

**Chord is the foundation of everything.** It is a standalone application-composition runtime, deliberately Pi-independent: *"it does not depend on any other Pi workspace package and can be used by unrelated applications"* (README). Its motivating example names your use case verbatim:

> "A single application feature may need to run in several environments: for example, an agent worker, a terminal UI, **and a remote WebUI**."

Five pieces:
1. **Facets/plugins** — synchronous setup units declaring `provide()`/`use()`/`provideMany()`/`observe()`; a host validates the graph, activates providers before consumers, disposes in reverse order. Facets are bundled *separately per environment* ("think backend, browser, TUI etc.").
2. **Services** — typed tokens, singleton or keyed; `{ local: true }` for process-local. Remotely exposable services get published into an auto-generated RPC catalogue.
3. **Replicated state** — `replicatedState(initial)`; producer mutates `state`, calls `publish(context)`; consumers get complete immutable values. Independent path-codec per client/state pairing.
4. **Delta tracking** (`@earendil-works/chord/delta`) — compact ops from tracked plain JSON: `r` replace, `s` set, `d` delete, `a` append, `t` truncate, `p` splice. Preserves string *append* and *front-truncation* so streaming tokens are cheap.
5. **Context** — Go-style cancellation/values, exported at `@earendil-works/chord/context`.

**Browser compatibility: yes for the runtime core.** Node-only code is quarantined behind the `./node` (vm/fs/crypto bundle loader) and `./bundler` (esbuild) subpath exports. `packages/chord/src/index.ts`, `/context`, `/delta` have **no `node:` imports**. `PLANNING.md:620` states the rule: *"If Node-only APIs are exported, they should use a separate package export … importing the main runtime must not load Node-only modules."* One caveat: `PLANNING.md:843` lists as an **open question** *"Whether browser-compatible core behavior is an immediate tested requirement or only an architectural constraint"* — i.e. it is a constraint, not yet CI-tested for chord specifically.

Test coverage is the strongest in the repo: 3559 lines (`delta.test.ts` 1141, `services.test.ts` 679, `facets.test.ts` 673, `facet-loader.test.ts` 394, `service-wire.test.ts` 269, `bundle.test.ts` 259).

---

## 5. Browser compatibility today

`/srv/pi/scripts/check-browser-smoke.mjs` runs on every `npm run check` (root `package.json` `"check"` script) and on pre-commit when `packages/ai/*` or `packages/web-ui/*` change. It esbuild-bundles `/srv/pi/scripts/browser-smoke-entry.ts` with `platform: "browser"` and fails the build on any Node-only import.

**That entry file is a direct statement of what upstream guarantees is browser-safe** (`scripts/browser-smoke-entry.ts:1-19`):
- `@earendil-works/pi-ai` (+ `/compat`: `complete`, `getModel`, `getProviders`, `streamSimple`)
- `@earendil-works/pi-agent-core` — including **`Agent`**, `convertToLlm`, `streamProxy`, skills/prompt-template formatting, `FileError`, `truncateHead`
- `@earendil-works/pi-protocol` — `encodeCbor`/`decodeCbor`/`PROTOCOL_VERSION`
- **`@earendil-works/pi-client`'s `Client`**

So: **yes, `pi-ai` is usable from a browser, and so is the whole agent core and the protocol client — this is enforced in CI.** A second check in the same script verifies selective-provider tree-shaking (a single provider SDK in a narrow bundle), which matters if you ever run the agent client-side.

Documented caveats (`packages/ai/README.md:1407-1431`): no env-var key resolution in browsers (pass `apiKey` or inject a `CredentialStore`); Bedrock unsupported; OAuth flows are Node-only but lazily imported so they don't pull into a bundle.

**There is no web UI in the repo.** What exists that is HTML-adjacent:
- `/srv/pi/packages/coding-agent/src/core/export-html/` (746 lines + `template.html`/`template.css`/`template.js`) — a static, self-contained transcript exporter with ANSI→HTML and per-tool renderers.
- `/srv/pi/packages/coding-agent/src/modes/interactive/session-share.ts` — `/share` uploads a JSONL transcript to `https://radius.pi.dev/v1/artifacts` and prints a canonical URL, or falls back to a private gist rendered at `https://pi.dev/session/<gistId>` (`packages/coding-agent/src/config.ts:515-519`). **So a hosted web session viewer already exists — read-only.**

---

## 6. Roadmap: what upstream is building toward

### 6a. The Radius WebSocket relay — already implemented

This is the biggest find for your project. `/srv/pi/packages/coding-agent/src/experimental/radius-relay.ts` (724 lines) bridges the pi-protocol byte stream over **WebSocket** through a hosted gateway (`https://radius.pi.dev`, `packages/ai/src/providers/radius-config.ts:4`):

- Subprotocols `pi-session-relay.host.v1` and `pi-session-relay.client.v1` (`radius-relay.ts:7-8`).
- `RadiusRelayHost` (`radius-relay.ts:104`) — the *server* dials **out** to the gateway (works behind NAT), authenticates with a bearer token, and multiplexes many logical connections over one socket using an 18-byte binary frame header (`radius-relay.ts:10-12`, `encodeRelayDataFrame` at line 592). Control messages are JSON strings (`ping`/`pong`/`connection_open`/`connection_close`); data messages are binary.
- `createRadiusClientTransportFactory()` (`radius-relay.ts:314`) — produces a `ByteTransportFactory`, i.e. it plugs straight into `Client`. Plus `RadiusClientReconnect` (line 344) with exponential backoff.
- It is written against the **browser** `WebSocket` API (undici's implementation), with an explicit comment about browser close-code restrictions (`radius-relay.ts:21-24`).

CLI surface: `--connect radius://<serverId>` or `--connect unix:///path.sock`, plus `--auth-token` / `--auth-token-file` (`/srv/pi/packages/coding-agent/src/cli/experimental/command-options.ts:39-95`). Auth resolution falls back to the stored Radius OAuth credential (`radius-auth.ts:16-56`).

**Practical implication: `RadiusRelayHost` + `Client` + a browser `ByteTransport` over `WebSocket` is a complete, already-working remote path. The web GUI does not need to invent a transport.**

### 6b. `pico` — the new harness design (the most recent work in the repo)

The four most recent commits are all pico (`ce5ec9ca3`, `2188891bf`, `e045ed2f3`, `73f3257dd`, by Mario Zechner, Sep 7-9 2026). Files:
- `/srv/pi/packages/agent/docs/pico/pico-v3.md` (1852 lines) — the design
- `/srv/pi/packages/agent/docs/pico/pico-usage-guide.md` (1066 lines) — the user-facing guide
- `/srv/pi/packages/agent/docs/pico/pico-work.md` (240 lines) — 20-package implementation plan
- `/srv/pi/packages/agent/docs/pico-v3.md` and `pico2.md` — earlier drafts

**What pico is:** a clean-room rewrite of the durable agent harness. One session file holding many *conversations*; each conversation is an append-only transcript of immutable *entries*, a set of *tasks* (every unit of work — generation, tool run, compaction, background job — is a crash-recoverable task record), and keyed *state*. Context is *derived*, not stored. All writes go through single-writer *commits*; ids are session sequence numbers.

**Why it matters enormously for a GUI** — from `pico-usage-guide.md:489-600`:

> "A UI never reads storage or parses commits. It watches a conversation and gets a **view**: a plain JSON object the harness keeps current, plus typed events that say what changed."

`ConversationView` = `{ conversation, entries, context, tasks, inbox, values, previews, faulted, readAt }`. Ten event kinds: `entry`, `task_start`, `task_update`, `task_end`, `task_output`, `value`, `inbox`, `context`, `fault`, `closed`. **`previews` is where streaming lives** — per live task, a Chord delta tracker.

And the explicitly named target (`pico-usage-guide.md:586`, "Remote Clients"):

> "The view is plain JSON and every event is proportional to its change, so a process without a harness (**mini's TUI, a phone**) runs the same fold on the same events. **`applyEvent(view, event)` is exported and needs no kinds**; preview ops are Chord delta ops, which the client applies with the same module."

`pico-v3.md:1731-1737` even specifies a cross-language replication contract so "a reducer in another language can't drift". `pico-work.md:211` ("20. Clients") names the gate: mini's TUI and the experimental agent's four seam files (`session-worker.ts`, `agent-controller-provider.ts`, `models-provider.ts`, `transcript-provider.ts`).

**This is upstream designing exactly the state-replication layer a web GUI needs, and it is unimplemented — the docs landed two days before this snapshot.**

### 6c. The facet/presentation-host plan explicitly reserves "web"

`/srv/pi/packages/agent/docs/plugins.md` is normative-ish design (73 KB). Key lines:
- `:16` — "A **presentation host** (**TUI today, web later**) owns a user interface."
- `:66` — the canonical plugin layout includes `web.ts  optional browser dialog and renderer`, alongside `contract.ts`, `session.ts`, `tui.ts`.
- `:70` — "The browser build never imports `session.ts`; the session process never imports TUI or DOM code."
- `:39` — "**A new surface is presentation-only work.** A web facet for the question dialog or the session picker registers against existing tokens; session and server code do not change."
- `:359` — "A future web host similarly binds local services for routes, views, and DOM dialogs."
- `:807`, `:1121` — worked examples: "TUI **and web** facets: observe every dialog instance" (the question extension) and the shared diff-review extension where "a web surface may expose the same operation as a button."

### 6d. Other roadmap signals

- `/srv/pi/packages/agent/docs/post-wp05-roadmap.md` — audit of the durable harness. Notable open item **R12**: `AgentHarness.watchSession()` is the *sole* unimplemented harness method (throws `SliceNotImplemented`) — i.e. **session-wide watch, which a web GUI's session list would want, does not exist yet**. Also flags an unresolved contradiction about whether raw `RemoteSession` mutation transport should come back.
- `/srv/pi/packages/agent/docs/mobile-handoff/` (33 files) — a handoff package covering delta tracking, scopes, exec-env, tool output, assistant message updates, facets, and a sandbox/membrane spike. `02-plugins/01-facets/facets.md:1583` describes an isolation model of "QuickJS-on-WASM with the scene graph and **no browser APIs at all**, while UI runs in an **iframe** with browser APIs and no scene access". Mobile and web are being planned together.
- Recent chord commits show consolidation toward this: `1a7bc80e7` "move service wire semantics into Chord", `fa5036836` "consolidate remote service adapters", `ae2cc5116` "replace lane RPC with Chord service", `c4b0e35ab` "keep services available during facet reloads", `9af45be82`/`f7079d562` delta tracking.
- Relay commits: `1d0d110ab` "connect experimental sessions through Radius", `35c49350f` "reconnect after abnormal Radius closure", `f55da4a9d` "allow exit while Radius reconnects", `23842b1e6` "tunnel proxied HTTP requests".
- **No `electron` or `tauri` anywhere in the repo.** Zero hits.
- README.md:47 points to external long-term plans: `https://rfc.earendil.com/keyword/pi/`.

---

## Concrete implications for your web GUI

1. **Do not write a new transport.** `Client` + `ByteTransportFactory` + browser `WebSocket` is ~50 lines, and `radius-relay.ts` already proves the wire format end-to-end.
2. **The protocol is not your integration surface — the Chord service contracts are.** Adding a capability means adding a service contract in `packages/coding-agent/src/experimental/services/`, not touching `pi-protocol`.
3. **Budget for the gaps: no auth, no approvals, no extension-UI dialogs over the wire, no server-side slash-command enumeration, no `watchSession()`.** All five are named continuation points in the docs, not oversights.
4. **`SlashCommands` and `PresentationUI` being `{ local: true }` is a design decision you'll collide with.** In the current model, presentation-side commands ship as *server-built plugin bundles* the client loads (`PresentationPlugins.prepareSession()` → `chord-facets.json` → `createFacetBundleLoader`). A browser can't use the Node `vm`-based loader at `chord/node`; you'd need a browser facet loader or a wire-level command list.
5. **Pin against pico.** The current `Transcript`/`LaneSnapshot` model is on the way out; `ConversationView` + `applyEvent` is the intended replication contract and is explicitly designed for non-terminal clients. Building a renderer against a view-plus-delta-ops shape (rather than against `LaneSnapshot` specifically) will survive the transition.
6. **For a shippable v1 today, the stdio RPC mode is far more complete** — it has documented model/thinking/compaction/retry/bash/session/commands surfaces plus the `extension_ui_request`/`extension_ui_response` sub-protocol that carries approval-style dialogs (`packages/coding-agent/docs/rpc.md:1184-1375`). It is the only one of the three with a stability commitment. The cost is that you own the process supervision and the WS bridge that the experimental server would otherwise give you.
