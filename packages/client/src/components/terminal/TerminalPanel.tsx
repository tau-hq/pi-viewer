import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { RotateCw } from "lucide-react";
import { useEffect } from "react";
import { t } from "@/i18n";
import {
	adoptTerminals,
	restartTerminal,
	type TerminalKind,
	type TerminalTab,
	useTerminalStore,
} from "@/store/terminal-store";
import { Button } from "../ui/button";
import { TerminalTabs } from "./TerminalTabs";
import { TerminalView } from "./TerminalView";

function ExitedBar({ tab }: { tab: TerminalTab }) {
	const label = tab.exitCode === undefined ? t("terminal.exitedUnknown") : t("terminal.exited", { code: tab.exitCode });
	return (
		<div
			data-testid="terminal-exited"
			className="flex h-8 shrink-0 items-center gap-3 border-border border-t bg-warning/10 px-3 text-warning text-xs"
		>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			<Button size="sm" variant="outline" onClick={() => void restartTerminal(tab)}>
				<RotateCw />
				{t("terminal.restart")}
			</Button>
		</div>
	);
}

/**
 * Body of the terminal panel, loaded lazily so xterm.js stays out of the chat bundle.
 *
 * The host owns the terminals, so the first show adopts whatever it already runs (page
 * reload, second browser tab) and only starts a shell when there is nothing to adopt.
 */
export default function TerminalPanel({ cwd }: { cwd: string }) {
	const tabs = useTerminalStore((s) => s.tabs);
	const activeKey = useTerminalStore((s) => s.activeKey);
	const setActive = useTerminalStore((s) => s.setActive);
	const setOpen = useTerminalStore((s) => s.setOpen);
	const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];

	useEffect(() => {
		let cancelled = false;
		void adoptTerminals().then(() => {
			if (cancelled) return;
			const store = useTerminalStore.getState();
			const first = store.tabs[0];
			if (!first) store.addTab("shell", cwd);
			else if (!store.activeKey) store.setActive(first.key);
		});
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	const create = (kind: TerminalKind) => {
		useTerminalStore.getState().addTab(kind, cwd);
	};

	return (
		<div data-testid="terminal-panel" className="flex min-h-0 flex-1 flex-col">
			<TerminalTabs
				tabs={tabs}
				activeKey={active?.key}
				onSelect={setActive}
				onCreate={create}
				onHide={() => setOpen(false)}
			/>
			{active ? (
				<TerminalView key={active.key} tabKey={active.key} kind={active.kind} cwd={active.cwd} />
			) : (
				<div className="flex flex-1 items-center justify-center text-muted-foreground text-xs">
					{t("terminal.empty")}
				</div>
			)}
			{active && !active.alive && <ExitedBar tab={active} />}
		</div>
	);
}
