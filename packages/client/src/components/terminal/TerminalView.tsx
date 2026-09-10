import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import {
	clearTerminalBuffer,
	openTerminal,
	registerTerminalWriter,
	type TerminalKind,
	useTerminalStore,
} from "@/store/terminal-store";
import { useUiStore } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { buildXtermTheme } from "./xterm-theme";

const FIT_DEBOUNCE_MS = 120;
const SCROLLBACK = 5_000;

interface TerminalViewProps {
	/** Stable tab key; the host's terminal id follows once `terminal.open` answered. */
	tabKey: string;
	kind: TerminalKind;
	cwd: string;
}

function monoFont(): string {
	const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
	return value.length > 0 ? value : "ui-monospace, SFMono-Regular, Menlo, monospace";
}

/**
 * One xterm.js instance bound to one host terminal.
 *
 * Mounting opens the PTY (or attaches to an existing one), unmounting only detaches so the
 * process keeps running. A reconnect re-attaches; the host replays the scrollback, so the
 * buffer is reset first to avoid duplicated output.
 */
export function TerminalView({ tabKey, kind, cwd }: TerminalViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [gone, setGone] = useState(false);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const transport = getTransport();
		const term = new Terminal({
			fontFamily: monoFont(),
			fontSize: 13,
			lineHeight: 1.2,
			cursorBlink: true,
			scrollback: SCROLLBACK,
			theme: buildXtermTheme(),
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener,noreferrer")));
		term.open(container);

		let disposed = false;
		let attached = false;
		let unregister = () => {};
		const idRef = { current: undefined as string | undefined };

		const safeFit = () => {
			try {
				fit.fit();
			} catch {
				// The container can be detached mid-animation; the next observer tick fits again.
			}
		};
		safeFit();

		const bind = (id: string) => {
			idRef.current = id;
			unregister();
			unregister = registerTerminalWriter(id, (data) => term.write(data));
		};

		const attach = async (id: string) => {
			// The scrollback replay repeats everything, so start from an empty buffer.
			clearTerminalBuffer(id);
			term.reset();
			try {
				await transport.send({ type: "terminal.attach", terminalId: id });
				if (!disposed) {
					attached = true;
					setGone(false);
				}
			} catch {
				if (!disposed) setGone(true);
			}
		};

		const start = async () => {
			const existing = useTerminalStore.getState().tabs.find((tab) => tab.key === tabKey)?.id;
			if (existing) {
				bind(existing);
				await attach(existing);
			} else {
				const info = await openTerminal(tabKey, kind, cwd, term.cols, term.rows);
				if (!info || disposed) return;
				bind(info.id);
				attached = true;
			}
			if (!disposed) term.focus();
		};
		void start();

		const onData = term.onData((data) => {
			const id = idRef.current;
			if (!id) return;
			void transport.send({ type: "terminal.input", terminalId: id, data }).catch(() => undefined);
		});
		const onResize = term.onResize(({ cols, rows }) => {
			const id = idRef.current;
			if (!id) return;
			void transport.send({ type: "terminal.resize", terminalId: id, cols, rows }).catch(() => undefined);
		});

		let fitTimer: ReturnType<typeof setTimeout> | undefined;
		const observer = new ResizeObserver(() => {
			if (fitTimer !== undefined) clearTimeout(fitTimer);
			fitTimer = setTimeout(safeFit, FIT_DEBOUNCE_MS);
		});
		observer.observe(container);

		// Re-theme on a theme switch. A rAF hop puts this after ThemeProvider has flipped the
		// `dark` class on <html>, so getComputedStyle already reads the new token values.
		let lastTheme = useUiStore.getState().theme;
		const offTheme = useUiStore.subscribe(() => {
			const next = useUiStore.getState().theme;
			if (next === lastTheme) return;
			lastTheme = next;
			requestAnimationFrame(() => {
				if (!disposed) term.options.theme = buildXtermTheme();
			});
		});

		const offStatus = transport.on("status", (status) => {
			if (status !== "connected") {
				attached = false;
				return;
			}
			const id = idRef.current;
			if (id && !attached) void attach(id);
		});

		return () => {
			disposed = true;
			if (fitTimer !== undefined) clearTimeout(fitTimer);
			observer.disconnect();
			offTheme();
			offStatus();
			onData.dispose();
			onResize.dispose();
			unregister();
			const id = idRef.current;
			// Detach only: the process stays alive for the next mount or page load.
			if (id) void transport.send({ type: "terminal.detach", terminalId: id }).catch(() => undefined);
			term.dispose();
		};
	}, [tabKey, kind, cwd]);

	return (
		<div className="relative min-h-0 flex-1 overflow-hidden bg-[var(--term-background)]">
			<div ref={containerRef} data-testid="terminal-surface" className="tau-terminal h-full w-full" />
			{gone && (
				<p className="absolute inset-x-0 bottom-0 bg-warning/15 px-3 py-1 text-warning text-xs">{t("terminal.gone")}</p>
			)}
		</div>
	);
}
