import type { GroupsState, SessionGroup, SessionSummary } from "@pi-tau/shared";
import { create } from "zustand";
import { movedGroupOrder } from "@/components/sidebar/grouping";
import { t } from "@/i18n";
import { asRecord, pickArray } from "@/lib/result-data";
import { isPendingPath } from "@/lib/session-match";
import { getTransport } from "@/transport/transport";
import { useSessionsStore } from "./sessions-store";
import { toast } from "./ui-store";

/**
 * Groups the user files sessions under. They live on the host (~/.tau/groups.json), so every
 * browser sees the same ones; this store keeps the list and updates it optimistically, then
 * takes the host's answer as the truth.
 */
interface GroupsStoreState {
	groups: SessionGroup[];
	/** Working directory to the name the user gave that project group; see grouping.ts. */
	projectNames: Record<string, string>;
	loaded: boolean;
	/**
	 * Sessions created for a group before pi wrote their file, as host handle to group id.
	 * `pending:` is no path the host can file, so the assignment waits for the real one.
	 */
	deferred: Record<string, string>;
	load: () => Promise<void>;
	/** Returns the new group, or undefined when the host refused. */
	createGroup: (name: string) => Promise<SessionGroup | undefined>;
	renameGroup: (id: string, name: string) => Promise<void>;
	/** Name a project group, or fall back to the folder name with `name: null`. */
	renameProject: (cwd: string, name: string | null) => Promise<void>;
	deleteGroup: (id: string) => Promise<void>;
	/** Swap the group with its neighbour; a group at the end stays put. */
	moveGroup: (id: string, direction: "up" | "down") => Promise<void>;
	/** File a session under a group, or back under its project with `groupId: null`. */
	assign: (sessionPath: string, groupId: string | null) => Promise<void>;
	/** Start a session in `cwd` and file it under `groupId` once it has a file. */
	createSessionIn: (cwd: string, groupId: string | null) => Promise<void>;
	/** Send the deferred assignments whose session file exists now. */
	flushDeferred: (sessions: SessionSummary[]) => void;
}

/** The answer of every groups command: the list, and the names given to project folders. */
function readState(data: unknown): GroupsState {
	const names = asRecord(asRecord(data)?.projectNames) ?? {};
	const projectNames: Record<string, string> = {};
	for (const [cwd, name] of Object.entries(names)) if (typeof name === "string") projectNames[cwd] = name;
	return { groups: pickArray<SessionGroup>(data, "groups"), projectNames };
}

function failed(command: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	toast("error", t("toast.commandFailed", { command, message }));
}

/**
 * Deferred assignments split into the ones that can be sent now and the ones whose session the
 * host does not list any more (deleted, or a process that died before writing a file).
 */
export function resolveDeferred(
	deferred: Record<string, string>,
	sessions: SessionSummary[],
): { ready: { handle: string; sessionPath: string; groupId: string }[]; stale: string[] } {
	const ready: { handle: string; sessionPath: string; groupId: string }[] = [];
	const stale: string[] = [];
	for (const [handle, groupId] of Object.entries(deferred)) {
		const summary = sessions.find((session) => (session.handle ?? session.id) === handle);
		if (!summary) {
			stale.push(handle);
			continue;
		}
		if (!isPendingPath(summary.path)) ready.push({ handle, sessionPath: summary.path, groupId });
	}
	return { ready, stale };
}

function without<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
	if (keys.length === 0) return record;
	const rest = { ...record };
	for (const key of keys) delete rest[key];
	return rest;
}

export const useGroupsStore = create<GroupsStoreState>()((set, get) => ({
	groups: [],
	projectNames: {},
	loaded: false,
	deferred: {},

	load: async () => {
		try {
			set({ ...readState(await getTransport().send({ type: "groups.list" })), loaded: true });
		} catch (error) {
			failed("groups.list", error);
		}
	},

	createGroup: async (name) => {
		const before = new Set(get().groups.map((group) => group.id));
		try {
			const state = readState(await getTransport().send({ type: "groups.create", name }));
			const { groups } = state;
			set({ ...state, loaded: true });
			// The new group is the one the old list did not have; the host keeps the ids.
			return groups.find((group) => !before.has(group.id));
		} catch (error) {
			failed("groups.create", error);
			return undefined;
		}
	},

	renameGroup: async (id, name) => {
		const previous = get().groups;
		set({ groups: previous.map((group) => (group.id === id ? { ...group, name } : group)) });
		try {
			set(readState(await getTransport().send({ type: "groups.rename", id, name })));
		} catch (error) {
			set({ groups: previous });
			failed("groups.rename", error);
		}
	},

	renameProject: async (cwd, name) => {
		const previous = get().projectNames;
		// The header shows the new name at once; only a refusal has to be taken back.
		const next = { ...previous };
		if (name === null) delete next[cwd];
		else next[cwd] = name;
		set({ projectNames: next });
		try {
			set(readState(await getTransport().send({ type: "groups.renameProject", cwd, name })));
		} catch (error) {
			set({ projectNames: previous });
			failed("groups.renameProject", error);
		}
	},

	deleteGroup: async (id) => {
		const previous = get().groups;
		// Its sessions fall back to their project, which the list shows before the host answers.
		set({ groups: previous.filter((group) => group.id !== id) });
		useSessionsStore.getState().dropSessionGroup(id);
		try {
			set(readState(await getTransport().send({ type: "groups.delete", id })));
			toast("info", t("groups.deleted"));
		} catch (error) {
			set({ groups: previous });
			failed("groups.delete", error);
			void useSessionsStore.getState().loadSessions();
		}
	},

	moveGroup: async (id, direction) => {
		const previous = get().groups;
		const ids = movedGroupOrder(previous, id, direction);
		if (!ids) return;
		const byId = new Map(previous.map((group) => [group.id, group] as const));
		set({
			groups: ids.flatMap((groupId, order) => {
				const group = byId.get(groupId);
				return group ? [{ ...group, order }] : [];
			}),
		});
		try {
			set(readState(await getTransport().send({ type: "groups.reorder", ids })));
		} catch (error) {
			set({ groups: previous });
			failed("groups.reorder", error);
		}
	},

	assign: async (sessionPath, groupId) => {
		const sessions = useSessionsStore.getState();
		const before = sessions.sessions.find((session) => session.path === sessionPath)?.groupId ?? null;
		sessions.setSessionGroup(sessionPath, groupId);
		try {
			// The row has already moved, so a successful move says nothing a toast could add.
			set(readState(await getTransport().send({ type: "groups.assign", sessionPath, groupId })));
		} catch (error) {
			useSessionsStore.getState().setSessionGroup(sessionPath, before);
			failed("groups.assign", error);
		}
	},

	createSessionIn: async (cwd, groupId) => {
		let handle: string;
		try {
			handle = await useSessionsStore.getState().create(cwd);
		} catch (error) {
			failed("sessions.create", error);
			return;
		}
		if (groupId === null) return;
		const summary = useSessionsStore.getState().sessions.find((session) => (session.handle ?? session.id) === handle);
		// pi writes the session file with the first answer, so a brand new session has no path
		// to file yet; the assignment goes out as soon as the list reports one.
		if (summary && !isPendingPath(summary.path)) await get().assign(summary.path, groupId);
		else set((state) => ({ deferred: { ...state.deferred, [handle]: groupId } }));
	},

	flushDeferred: (sessions) => {
		const { deferred } = get();
		if (Object.keys(deferred).length === 0) return;
		const { ready, stale } = resolveDeferred(deferred, sessions);
		if (ready.length === 0 && stale.length === 0) return;
		set({ deferred: without(deferred, [...stale, ...ready.map((entry) => entry.handle)]) });
		for (const entry of ready) void get().assign(entry.sessionPath, entry.groupId);
	},
}));
