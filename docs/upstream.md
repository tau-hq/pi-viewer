# Taking a pi upgrade

Pi Viewer depends on pi through exactly three seams (RPC mode, one SDK adapter file, the
extension API). An upgrade always runs in this order:

1. **Read the changelog** —
   [`packages/coding-agent/CHANGELOG.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md)
   upstream, every "Breaking Changes" section since the pinned version. Relevant: changes to
   `--mode rpc` (commands, events, `extension_ui_*`), to the extension API (`tool_call`,
   `registerCommand`, `ctx.ui.*`, `ctx.navigateTree`), and to the SDK exports used by
   `packages/host/src/pi-sdk.ts`.
2. **Bump the pin** —
   `npm install --ignore-scripts -w @pi-tau/host @earendil-works/pi-coding-agent@<version>`,
   and align the `peerDependencies` of `packages/pi-extension`. Always an exact version.
3. **Integrity tests** — `npx vitest run --project host` runs
   `packages/host/test/pi-integrity.test.ts` (version, SDK exports, an RPC start without a
   model) plus the translation tests against the recorded RPC sample in `docs/research/`.
4. **Refresh the recording** if event shapes changed:
   `S=<scratch> python3 docs/research/rpc-spike.py` produces a new capture against the
   configured model; store it as `rpc-sample-<version>.jsonl` and point the tests at it.
5. **End to end** — start the host, run `npm run test:e2e`.
6. **Extension spot-check** — an approval dialog must appear for a mutating tool call in
   Manual mode; `/tau-tools` and `/tau-tree` must answer through the UI.

What is never touched: pi's source, pi's files under `~/.pi/agent/` (except your own
`models.json`), and pi's internal `dist/**` modules beyond the published `bin` and
`rpc-entry` entry points.
