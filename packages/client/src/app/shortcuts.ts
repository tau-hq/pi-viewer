import { cycleApprovalMode } from "@/components/composer/ModeMenu";
import type { TKey } from "@/i18n";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useTerminalStore } from "@/store/terminal-store";
import { useUiStore } from "@/store/ui-store";

export type ShortcutGroup = "global" | "composer" | "dialogs" | "terminal";

export interface ShortcutSpec {
	id: string;
	group: ShortcutGroup;
	/** Keys as the overview shows them; a middle dot separates alternatives. */
	keys: string;
	description: TKey;
	/**
	 * Global shortcuts are handled centrally: `match` decides, `run` acts. Entries without
	 * them belong to the component that owns the focus (composer, dialog, terminal) and are
	 * listed here so the overview cannot drift away from what the app really does.
	 */
	match?: (event: KeyboardEvent) => boolean;
	run?: () => void;
}

function mod(event: KeyboardEvent): boolean {
	return event.ctrlKey || event.metaKey;
}

/** A dialog is up: either one of Tau's own or any Radix dialog (approval, drawer). */
function dialogIsOpen(): boolean {
	return useUiStore.getState().dialog !== undefined || document.querySelector('[role="dialog"]') !== null;
}

/** Places that use Shift+Tab themselves: focus traps, menus and the terminal. */
function ownsShiftTab(target: EventTarget | null): boolean {
	return (
		target instanceof Element &&
		target.closest('[data-testid="terminal-surface"], [role="menu"], [role="dialog"], [role="listbox"]') !== null
	);
}

/** True while the keystroke goes into a text field, so plain letter shortcuts must stay out. */
function isEditable(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** The composer of the shown session holds no unsent text (drafts are dropped when empty). */
function composerIsEmpty(): boolean {
	const sessionId = useSessionsStore.getState().currentSessionId;
	if (!sessionId) return true;
	const draft = useUiStore.getState().drafts[sessionId];
	return draft === undefined || draft.text.length === 0;
}

function runIsActive(): boolean {
	const sessionId = useSessionsStore.getState().currentSessionId;
	if (!sessionId) return false;
	const view = useSessionStore.getState().views[sessionId];
	return !!view && (view.runActive || view.state.isStreaming);
}

/**
 * Every keyboard shortcut of the web interface, in one table: the global ones carry their own
 * handler, the rest document what their component implements. The overview dialog renders this.
 */
export const SHORTCUTS: readonly ShortcutSpec[] = [
	{
		id: "quickSwitcher",
		group: "global",
		keys: "Ctrl/⌘+K",
		description: "hotkeys.quickSwitcher",
		match: (event) => mod(event) && !event.shiftKey && event.key.toLowerCase() === "k",
		run: () => {
			const ui = useUiStore.getState();
			if (ui.dialog === "quickSwitcher") ui.closeDialog();
			else ui.openDialog("quickSwitcher");
		},
	},
	{
		id: "newSession",
		group: "global",
		keys: "Ctrl/⌘+Shift+N",
		description: "hotkeys.newSession",
		match: (event) => mod(event) && event.shiftKey && event.key.toLowerCase() === "n",
		run: () => useUiStore.getState().openDialog("newSession"),
	},
	{
		id: "terminalPanel",
		group: "global",
		keys: "Ctrl/⌘+`",
		description: "hotkeys.terminalPanel",
		match: (event) => mod(event) && !event.shiftKey && (event.key === "`" || event.code === "Backquote"),
		run: () => useTerminalStore.getState().toggle(),
	},
	{
		id: "sessionSearch",
		group: "global",
		keys: "Ctrl/⌘+F",
		description: "hotkeys.sessionSearch",
		// Deliberately shadows the browser's own find: that one cannot see abandoned branches
		// or history a compaction replaced, and it stops at what the virtual list has rendered.
		match: (event) => mod(event) && !event.shiftKey && event.key.toLowerCase() === "f" && !dialogIsOpen(),
		run: () => useUiStore.getState().openSearch(),
	},
	{
		id: "hotkeys",
		group: "global",
		keys: "?",
		description: "hotkeys.hotkeysList",
		match: (event) =>
			event.key === "?" && !mod(event) && !isEditable(event.target) && !dialogIsOpen() && composerIsEmpty(),
		run: () => useUiStore.getState().openDialog("hotkeys"),
	},
	{
		id: "approvalMode",
		group: "global",
		keys: "Shift+Tab",
		description: "hotkeys.approvalMode",
		match: (event) =>
			event.key === "Tab" &&
			event.shiftKey &&
			!mod(event) &&
			!event.altKey &&
			!dialogIsOpen() &&
			!ownsShiftTab(event.target),
		run: cycleApprovalMode,
	},
	{
		id: "abort",
		group: "global",
		keys: "Esc",
		description: "hotkeys.abort",
		match: (event) => event.key === "Escape" && !dialogIsOpen() && runIsActive(),
		run: () => {
			void useSessionsStore
				.getState()
				.command({ type: "abort" })
				.catch(() => undefined);
		},
	},
	{ id: "send", group: "composer", keys: "↵", description: "hotkeys.send" },
	{ id: "newline", group: "composer", keys: "Shift+↵", description: "hotkeys.newline" },
	{ id: "followUp", group: "composer", keys: "Alt+↵", description: "hotkeys.followUp" },
	{ id: "slash", group: "composer", keys: "/", description: "hotkeys.slash" },
	{ id: "mention", group: "composer", keys: "@", description: "hotkeys.mention" },
	{ id: "bash", group: "composer", keys: "! · !!", description: "hotkeys.bash" },
	{ id: "composerEscape", group: "composer", keys: "Esc", description: "hotkeys.escape" },
	{ id: "paste", group: "composer", keys: "Ctrl/⌘+V", description: "hotkeys.paste" },
	{ id: "navigate", group: "dialogs", keys: "↑ ↓", description: "hotkeys.navigate" },
	{ id: "pick", group: "dialogs", keys: "↵", description: "hotkeys.pick" },
	{ id: "close", group: "dialogs", keys: "Esc", description: "hotkeys.close" },
	{ id: "modeKeys", group: "dialogs", keys: "1 … 4", description: "hotkeys.modeKeys" },
	{ id: "approvalKeys", group: "dialogs", keys: "A · S · D", description: "hotkeys.approvalKeys" },
	{ id: "terminalToggle", group: "terminal", keys: "Ctrl/⌘+`", description: "hotkeys.terminalPanel" },
	{ id: "terminalKeys", group: "terminal", keys: "…", description: "hotkeys.terminalKeys" },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ["global", "composer", "dialogs", "terminal"];

export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, TKey> = {
	global: "hotkeys.global",
	composer: "hotkeys.composer",
	dialogs: "hotkeys.dialogs",
	terminal: "hotkeys.terminal",
};

export function shortcutsOf(group: ShortcutGroup): ShortcutSpec[] {
	return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

/** The first global shortcut that claims this event, if any. */
export function matchShortcut(event: KeyboardEvent): ShortcutSpec | undefined {
	return SHORTCUTS.find(
		(shortcut) => shortcut.match !== undefined && shortcut.run !== undefined && shortcut.match(event),
	);
}
