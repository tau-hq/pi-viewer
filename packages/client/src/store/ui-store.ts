import type { ImageInput } from "@pi-tau/shared";
import { create } from "zustand";
import { pruneSeen, readSeen, type SeenMap, writeSeen } from "@/lib/seen";
import { readStorage, writeStorage } from "@/lib/storage";

export type Theme = "dark" | "light";
export type ToastLevel = "info" | "warning" | "error";

export interface Toast {
	id: number;
	level: ToastLevel;
	message: string;
	createdAt: number;
}

export type DialogKind =
	| "newSession"
	| "quickSwitcher"
	| "fork"
	| "compact"
	| "model"
	| "thinking"
	| "rename"
	| "tools"
	| "tree"
	| "providers"
	| "config"
	| "packages"
	| "commands"
	| "sessionSettings"
	| "scopedModels"
	| "importSession"
	| "hotkeys"
	| "changelog";

/** Unsent composer content of a session, kept while another session is shown. */
export interface ComposerDraft {
	text: string;
	images: ImageInput[];
}

const THEME_KEY = "tau.theme";
const SIDEBAR_KEY = "tau.sidebar";
const COLLAPSED_KEY = "tau.sidebar.collapsed";

function initialTheme(): Theme {
	const stored = readStorage(THEME_KEY);
	if (stored === "light" || stored === "dark") return stored;
	return "dark";
}

/** Keys of the sidebar groups the user folded shut, see components/sidebar/grouping.ts. */
function initialCollapsed(): Record<string, true> {
	const raw = readStorage(COLLAPSED_KEY);
	if (raw === null) return {};
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return {};
		const out: Record<string, true> = {};
		for (const key of parsed) if (typeof key === "string") out[key] = true;
		return out;
	} catch {
		return {};
	}
}

interface UiStoreState {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	/** Docked sidebar on wide layouts; persisted. */
	sidebarOpen: boolean;
	toggleSidebar: () => void;
	/** Sidebar drawer on narrow layouts; always starts closed. */
	drawerOpen: boolean;
	setDrawerOpen: (open: boolean) => void;
	dialog: DialogKind | undefined;
	openDialog: (dialog: DialogKind) => void;
	closeDialog: () => void;
	toasts: Toast[];
	pushToast: (level: ToastLevel, message: string) => number;
	dismissToast: (id: number) => void;
	drafts: Record<string, ComposerDraft>;
	setDraft: (sessionId: string, draft: ComposerDraft | undefined) => void;
	/** Text a dialog asked to put into the composer; the nonce keeps repeats distinguishable. */
	composerInsert: { sessionId: string; text: string; nonce: number; append: boolean } | undefined;
	/** `append` keeps an unsent draft and adds the text on a new line instead of replacing it. */
	insertIntoComposer: (sessionId: string, text: string, append?: boolean) => void;
	/** Transcript scroll offset per session; a missing entry means "follow the bottom". */
	scrollOffsets: Record<string, number>;
	setScrollOffset: (sessionId: string, offset: number | undefined) => void;
	/**
	 * Automatic retry per session. pi accepts `setAutoRetry` but never reports the value, so
	 * this is Tau's own optimistic copy: a missing entry means on, and a page reload forgets it.
	 */
	autoRetry: Record<string, boolean>;
	setAutoRetry: (sessionId: string, enabled: boolean) => void;
	/** Per session id the `modified` timestamp the user last saw; persisted, see lib/seen.ts. */
	seen: SeenMap;
	/** Remember that the session was looked at in this state. Older marks are ignored. */
	markSeen: (sessionId: string, modified: number) => void;
	/**
	 * Session search in the header. The nonce rises on every open request so pressing the
	 * shortcut again puts the caret back into a field that is already showing.
	 */
	searchOpen: boolean;
	searchNonce: number;
	/** What is typed in the search field; the transcript marks it, so it cannot stay local. */
	searchQuery: string;
	setSearchQuery: (query: string) => void;
	/** The hit the counter is naming: its entry, and which occurrence inside it. */
	searchActiveEntry: string | undefined;
	searchActiveIndex: number;
	setSearchActive: (entryId: string | undefined, index: number) => void;
	openSearch: () => void;
	closeSearch: () => void;
	/** Entry the transcript should scroll to and flash; the nonce allows the same one twice. */
	reveal: { sessionId: string; entryId: string; nonce: number } | undefined;
	revealEntry: (sessionId: string, entryId: string) => void;
	/** Sidebar groups folded shut, by group key; persisted, so a fold survives a reload. */
	collapsedGroups: Record<string, true>;
	toggleGroupCollapsed: (key: string) => void;
}

let toastSeq = 0;

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
	if (!(key in record)) return record;
	const { [key]: _removed, ...rest } = record;
	return rest;
}

export const useUiStore = create<UiStoreState>()((set) => ({
	theme: initialTheme(),
	setTheme: (theme) => {
		writeStorage(THEME_KEY, theme);
		set({ theme });
	},
	sidebarOpen: readStorage(SIDEBAR_KEY) !== "closed",
	toggleSidebar: () =>
		set((s) => {
			writeStorage(SIDEBAR_KEY, s.sidebarOpen ? "closed" : "open");
			return { sidebarOpen: !s.sidebarOpen };
		}),
	drawerOpen: false,
	setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
	dialog: undefined,
	openDialog: (dialog) => set({ dialog }),
	closeDialog: () => set({ dialog: undefined }),
	toasts: [],
	pushToast: (level, message) => {
		const id = ++toastSeq;
		set((s) => ({ toasts: [...s.toasts.slice(-7), { id, level, message, createdAt: Date.now() }] }));
		return id;
	},
	dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((toast) => toast.id !== id) })),
	drafts: {},
	setDraft: (sessionId, draft) =>
		set((s) => ({ drafts: draft ? { ...s.drafts, [sessionId]: draft } : without(s.drafts, sessionId) })),
	composerInsert: undefined,
	insertIntoComposer: (sessionId, text, append = false) =>
		set((s) => ({ composerInsert: { sessionId, text, append, nonce: (s.composerInsert?.nonce ?? 0) + 1 } })),
	autoRetry: {},
	setAutoRetry: (sessionId, enabled) => set((s) => ({ autoRetry: { ...s.autoRetry, [sessionId]: enabled } })),
	seen: readSeen(),
	markSeen: (sessionId, modified) =>
		set((s) => {
			const known = s.seen[sessionId];
			if (known !== undefined && known >= modified) return s;
			const seen = pruneSeen({ ...s.seen, [sessionId]: modified });
			writeSeen(seen);
			return { seen };
		}),
	searchOpen: false,
	searchNonce: 0,
	searchQuery: "",
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	searchActiveEntry: undefined,
	searchActiveIndex: 0,
	setSearchActive: (searchActiveEntry, searchActiveIndex) => set({ searchActiveEntry, searchActiveIndex }),
	openSearch: () => set((s) => ({ searchOpen: true, searchNonce: s.searchNonce + 1 })),
	closeSearch: () => set({ searchOpen: false, searchQuery: "", searchActiveEntry: undefined, searchActiveIndex: 0 }),
	reveal: undefined,
	revealEntry: (sessionId, entryId) =>
		set((s) => ({ reveal: { sessionId, entryId, nonce: (s.reveal?.nonce ?? 0) + 1 } })),
	collapsedGroups: initialCollapsed(),
	toggleGroupCollapsed: (key) =>
		set((s) => {
			const collapsedGroups =
				key in s.collapsedGroups ? without(s.collapsedGroups, key) : { ...s.collapsedGroups, [key]: true as const };
			writeStorage(COLLAPSED_KEY, JSON.stringify(Object.keys(collapsedGroups)));
			return { collapsedGroups };
		}),
	scrollOffsets: {},
	setScrollOffset: (sessionId, offset) =>
		set((s) => ({
			scrollOffsets:
				offset === undefined ? without(s.scrollOffsets, sessionId) : { ...s.scrollOffsets, [sessionId]: offset },
		})),
}));

export function toast(level: ToastLevel, message: string): void {
	useUiStore.getState().pushToast(level, message);
}
