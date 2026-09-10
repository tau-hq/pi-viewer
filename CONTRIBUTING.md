# Contributing

Thanks for looking under the hood. The most important thing to know: Pi Viewer's whole value
is that it **never forks pi** — see [docs/architecture.md](docs/architecture.md) before
changing anything near the pi boundary.

## Setting up

Requirements: Node ≥ 22.19. For the browser tests, Playwright's Chromium
(`npx playwright install chromium`) and a configured model provider (see below).

```bash
git clone https://github.com/tau-hq/pi-viewer.git
cd pi-viewer
npm install
npm run dev        # host on http://127.0.0.1:8787, serving packages/client/dist
```

For client work, run Vite alongside for hot reload:

```bash
npm run dev -w @pi-tau/client    # http://127.0.0.1:5173, proxied to the host
```

Model access is pi's own configuration (`~/.pi/agent/models.json` or the providers dialog in
the GUI). If you already use pi, nothing to do.

## Tests

```bash
npm run check      # Biome (format + lint) and TypeScript project references
npm test           # unit tests, host + client (no model, no network)
npm run test:e2e   # Playwright against the running host
```

The e2e suite runs against a **real pi and a real model** — no mocks. Three tests send actual
prompts, so a full run costs a few model calls; everything else avoids the model by importing
fixture sessions or using shell entries. The suite cleans up after itself: after a full run
your machine holds exactly the sessions, groups and trust decisions it held before. Please
keep new tests to that standard — create sessions through `e2eSessionName()` and delete them
in `afterAll`.

## What a good change looks like

- **Don't cross the pi seam.** pi is used from npm, exactly pinned. New capabilities come
  from RPC, the single SDK adapter (`packages/host/src/pi-sdk.ts`) or the extension
  (`packages/pi-extension`) — in that order of preference. Never import pi's internal
  modules, never read or write pi's files.
- **The wire protocol is the contract.** Client and host share only `packages/shared`.
  A new feature usually means: protocol type → host command → store → component, each with
  its test.
- **Tau-owned state needs care**: anything in `SessionState` that pi does not know
  (approval mode, needsInput, …) must be carried over in the host's `refreshState`, or it
  silently dies on the first refresh.
- **Comments explain why, not what.** The codebase leans on short prose comments where a
  decision is not obvious from the code; match that.
- Formatting and lint are `biome check --write .` — no debates, the tool decides.
- Small PRs with a test that fails before the change and passes after it beat large ones.

## Upgrading pi

Version bumps follow a fixed procedure — changelog, pin, integrity tests, recorded-sample
refresh, e2e — documented in [docs/upstream.md](docs/upstream.md).

## Reporting issues

A good report names the pi version (`pi --version`), the commit of Pi Viewer, what you did,
what you expected, and what happened instead. For host issues, the journal/console output of
the host process usually contains the answer.
