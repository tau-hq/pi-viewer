import type { TerminalInfo } from "@pi-tau/shared";
import { create } from "zustand";
import { t } from "@/i18n";
import { randomId } from "@/lib/ids";
import { asRecord, pickArray } from "@/lib/result-data";
import { readStorage, readStoredNumber, writeStorage } from "@/lib/storage";
import { getTransport } from "@/transport/transport";
import { toast } from "./ui-store";

export type TerminalKind = "pi" | "shell";

/**
 * One tab of the terminal panel. `key` is stable for the tab's lifetime; `id` is the host's
 * terminal id and only exists once `terminal.open` has answered (or the tab was adopted from
 * `terminal.list`), so a freshly created tab can already be rendered and measured.
 */
export interface TerminalTab {
	key: string;
	id: string | undefined;
	kind: TerminalKind;
	cwd: string;
	alive: boolean;
	/** Exit code once the process ended; undefined while it runs or when the host reported none. */
	exitCode: number | undefined;
}

const OPEN_KEY = "tau.terminal.open";
const HEIGHT_KEY = "tau.terminal.height";
export const TERMINAL_MIN_HEIGHT = 120;
const TERMINAL_MAX_HEIGHT = 900;
const DEFAULT_HEIGHT = 320;

/** Per-terminal cap for output that arrives before the xterm instance is ready. */
const PENDING_BYTES = 512 * 1024;

/** Parse a TerminalInfo defensively; the tabs read every field of it. */
function toInfo(data: unknown): TerminalInfo | undefined {
	const record = asRecord(data);
	if (!record || typeof record.id !== "string") return undefined;
	return {
		id: record.id,
		kind: record.kind === "pi" ? "pi" : "shell",
		cwd: typeof record.cwd === "string" ? record.cwd : "",
		alive: record.alive !== false,
		cols: typeof record.cols === "number" ? record.cols : 80,
		rows: typeof record.rows === "number" ? record.rows : 24,
		startedAt: typeof record.startedAt === "number" ? record.startedAt : Date.now(),
		...(typeof record.sessionPath === "string" ? { sessionPath: record.sessionPath } : {}),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface TerminalStoreState {
	open: boolean;
	height: number;
	tabs: TerminalTab[];
	/** Tab key of the shown terminal. */
	activeKey: string | undefined;
	setOpen: (open: boolean) => void;
	toggle: () => void;
	/** Panel height in px; `persist` is false while dragging and true when the drag ends. */
	setHeight: (height: number, persist?: boolean) => void;
	setActive: (key: string) => void;
	/** Add a tab that still has to be opened on the host (needs measured cols/rows first). */
	addTab: (kind: TerminalKind, cwd: string) => string;
	/** Attach the host's terminal id to a tab after `terminal.open` answered. */
	bindTab: (key: string, info: TerminalInfo) => void;
	removeTab: (key: string) => void;
	/** Turn an exited tab back into a fresh, unopened one at the same position. */
	restartTab: (key: string) => void;
	markExit: (id: string, code: number | undefined) => void;
	/** Adopt terminals the host already runs (after a reload or a reconnect). */
	adopt: (infos: TerminalInfo[]) => void;
}

export const useTerminalStore = create<TerminalStoreState>()((set, get) => ({
	open: readStorage(OPEN_KEY) === "open",
	height: readStoredNumber(HEIGHT_KEY, DEFAULT_HEIGHT, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT),
	tabs: [],
	activeKey: undefined,

	setOpen: (open) => {
		writeStorage(OPEN_KEY, open ? "open" : "closed");
		set({ open });
	},
	toggle: () => get().setOpen(!get().open),
	setHeight: (height, persist = true) => {
		const clamped = Math.min(TERMINAL_MAX_HEIGHT, Math.max(TERMINAL_MIN_HEIGHT, Math.round(height)));
		if (persist) writeStorage(HEIGHT_KEY, String(clamped));
		set({ height: clamped });
	},
	setActive: (activeKey) => set({ activeKey }),

	addTab: (kind, cwd) => {
		const key = randomId();
		set((s) => ({
			tabs: [...s.tabs, { key, id: undefined, kind, cwd, alive: true, exitCode: undefined }],
			activeKey: key,
		}));
		return key;
	},

	bindTab: (key, info) =>
		set((s) => ({
			tabs: s.tabs.map((tab) =>
				tab.key === key ? { ...tab, id: info.id, kind: info.kind, cwd: info.cwd, alive: info.alive } : tab,
			),
		})),

	removeTab: (key) =>
		set((s) => {
			const index = s.tabs.findIndex((tab) => tab.key === key);
			if (index < 0) return s;
			const tabs = s.tabs.filter((tab) => tab.key !== key);
			const activeKey = s.activeKey === key ? (tabs[Math.min(index, tabs.length - 1)]?.key ?? undefined) : s.activeKey;
			return { tabs, activeKey };
		}),

	restartTab: (key) =>
		set((s) => {
			const fresh = randomId();
			return {
				tabs: s.tabs.map((tab) =>
					tab.key === key ? { ...tab, key: fresh, id: undefined, alive: true, exitCode: undefined } : tab,
				),
				activeKey: s.activeKey === key ? fresh : s.activeKey,
			};
		}),

	markExit: (id, code) =>
		set((s) => ({
			tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, alive: false, exitCode: code } : tab)),
		})),

	adopt: (infos) =>
		set((s) => {
			const known = new Set(s.tabs.map((tab) => tab.id));
			const added = infos
				.filter((info) => !known.has(info.id))
				.map<TerminalTab>((info) => ({
					key: info.id,
					id: info.id,
					kind: info.kind,
					cwd: info.cwd,
					alive: info.alive,
					exitCode: undefined,
				}));
			const byId = new Map(infos.map((info) => [info.id, info]));
			const tabs = [
				...s.tabs.map((tab) => {
					const info = tab.id === undefined ? undefined : byId.get(tab.id);
					return info ? { ...tab, alive: info.alive } : tab;
				}),
				...added,
			];
			return { tabs, activeKey: s.activeKey ?? tabs[0]?.key };
		}),
}));

// ---------------------------------------------------------------------------
// PTY output routing
//
// Output is handed to the xterm instance of its tab directly instead of through the store:
// it arrives in many small chunks and must not re-render React. Data that arrives before the
// instance is ready (the host replays the scrollback while `terminal.attach` is still in
// flight) is buffered per terminal and flushed on registration.
// ---------------------------------------------------------------------------

type Writer = (data: string) => void;

const writers = new Map<string, Writer>();
const pending = new Map<string, string[]>();

export function registerTerminalWriter(id: string, writer: Writer): () => void {
	writers.set(id, writer);
	const buffered = pending.get(id);
	if (buffered) {
		pending.delete(id);
		for (const chunk of buffered) writer(chunk);
	}
	return () => {
		if (writers.get(id) === writer) writers.delete(id);
	};
}

export function handleTerminalData(id: string, data: string): void {
	const writer = writers.get(id);
	if (writer) {
		writer(data);
		return;
	}
	const buffered = pending.get(id) ?? [];
	buffered.push(data);
	let total = buffered.reduce((sum, chunk) => sum + chunk.length, 0);
	while (total > PENDING_BYTES && buffered.length > 1) {
		total -= (buffered.shift() as string).length;
	}
	pending.set(id, buffered);
}

/** Drop buffered output of a terminal, e.g. before a re-attach replays the scrollback. */
export function clearTerminalBuffer(id: string): void {
	pending.delete(id);
}

// ---------------------------------------------------------------------------
// Host calls
// ---------------------------------------------------------------------------

/** Keys with a `terminal.open` in flight; guards the double mount of React's strict mode. */
const opening = new Set<string>();

export async function openTerminal(
	key: string,
	kind: TerminalKind,
	cwd: string,
	cols: number,
	rows: number,
): Promise<TerminalInfo | undefined> {
	const store = useTerminalStore.getState();
	if (opening.has(key)) return undefined;
	opening.add(key);
	try {
		const data = await getTransport().send({ type: "terminal.open", kind, cwd, cols, rows });
		const info = toInfo(data);
		if (!info) throw new Error(t("connection.badResult"));
		store.bindTab(key, info);
		return info;
	} catch (error) {
		toast("error", t("terminal.openFailed", { message: errorMessage(error) }));
		store.removeTab(key);
		return undefined;
	} finally {
		opening.delete(key);
	}
}

/** Close a terminal on the host and drop its tab. Tabs without an id were never opened. */
export async function closeTerminal(tab: TerminalTab): Promise<void> {
	useTerminalStore.getState().removeTab(tab.key);
	if (!tab.id) return;
	clearTerminalBuffer(tab.id);
	try {
		await getTransport().send({ type: "terminal.close", terminalId: tab.id });
	} catch {
		// A terminal the host has already forgotten needs no closing.
	}
}

/** Kill the exited process behind a tab and let the tab open a fresh one. */
export async function restartTerminal(tab: TerminalTab): Promise<void> {
	if (tab.id) {
		clearTerminalBuffer(tab.id);
		try {
			await getTransport().send({ type: "terminal.close", terminalId: tab.id });
		} catch {
			// Already gone on the host.
		}
	}
	useTerminalStore.getState().restartTab(tab.key);
}

/** Ask the host which terminals it runs and adopt them as tabs. */
export async function adoptTerminals(): Promise<void> {
	try {
		const data = await getTransport().send({ type: "terminal.list" });
		const infos = pickArray<unknown>(data, "terminals")
			.map(toInfo)
			.filter((info): info is TerminalInfo => info !== undefined);
		useTerminalStore.getState().adopt(infos);
	} catch {
		// Terminals may be unavailable on this host (no node-pty); the panel then just stays empty.
	}
}
