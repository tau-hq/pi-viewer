# Pi aktualisieren

Tau haengt an Pi ueber genau drei Naehte. Ein Update laeuft immer in dieser Reihenfolge:

1. **Changelog lesen**: `https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md`,
   Abschnitte "Breaking Changes" seit der gepinnten Version. Relevant sind Aenderungen an
   `--mode rpc` (Befehle, Events, `extension_ui_*`), an der Extension-API (`tool_call`,
   `registerCommand`, `appendEntry`, `ctx.ui.*`) und an den SDK-Exporten, die
   `packages/host/src/pi-sdk.ts` nutzt (`VERSION`, `getAgentDir`, `SessionManager`,
   `ModelRuntime`, `SettingsManager`).
2. **Version anheben**: `npm install --ignore-scripts -w @pi-tau/host @earendil-works/pi-coding-agent@<version>`
   und die `peerDependencies` in `packages/pi-extension/package.json` angleichen. Exakt pinnen.
3. **Integritaetstest**: `./node_modules/.bin/vitest run --project host` fuehrt
   `packages/host/test/pi-integrity.test.ts` aus (Version, SDK-Exporte, RPC-Start ohne Modell)
   und die Uebersetzungstests gegen den Mitschnitt `docs/research/rpc-sample-0.85.1.jsonl`.
4. **Mitschnitt erneuern**, wenn sich Event-Formen geaendert haben:
   `S=<scratch> python3 docs/research/rpc-spike.py` erzeugt `rpc-spike.jsonl` gegen das
   konfigurierte Modell; als `docs/research/rpc-sample-<version>.jsonl` ablegen und den
   Testpfad anpassen.
5. **End-to-End**: Host starten, `node e2e/flow.mjs` und `npm run test:e2e`.
6. **Extension pruefen**: `TAU_APPROVAL=mutating` mit einem bash-Aufruf (Freigabedialog muss
   erscheinen), `/tau-tools` und `/tau-tree` ueber die Oberflaeche.

Was NICHT angefasst wird: Pis Quellcode, Pis Dateien unter `~/.pi/agent/` (ausser der eigenen
`models.json`), interne Module unter `dist/**` ausser dem `bin`-Eintrag und `rpc-entry`.

Der Fork unter `/srv/pi` dient nur dem Quellstudium (`git fetch upstream` dort, siehe
`/srv/pi/FORK.md`); Tau installiert Pi aus npm.
