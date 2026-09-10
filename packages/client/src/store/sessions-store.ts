import type { ModelInfo, ProjectInfo, SessionCommand, SessionCreateOptions, SessionSummary } from "@pi-tau/shared";
import { create } from "zustand";
import { t } from "@/i18n";
import { copyText, downloadText } from "@/lib/download";
import { lastAssistantText } from "@/lib/messages";
import { asRecord, pickArray, pickString } from "@/lib/result-data";
import { isActiveSummary, isPendingPath } from "@/lib/session-match";
import { getTransport } from "@/transport/transport";
import { TransportError } from "@/transport/ws";
import { useSessionStore } from "./session-store";
import { toast, useUiStore } from "./ui-store";

interface SessionsStoreState {
	sessions: SessionSummary[];
	projects: ProjectInfo[];
	models: ModelInfo[];
	currentSessionId: string | undefined;
	loaded: boolean;
	loadAll: () => Promise<void>;
	loadSessions: () => Promise<void>;
	loadModels: () => Promise<void>;
	/** pi's `update --models`: fetch the provider catalogs again and keep the result. */
	refreshModels: () => Promise<void>;
	/** Show a session: subscribe to it and drop the previous subscription unless it is streaming. */
	select: (sessionId: string | undefined) => void;
	/** Open (spawn if needed) a listed session and show it. Returns the live session id. */
	open: (summary: SessionSummary) => Promise<string>;
	/** `options` carries pi's startup flags (system prompt, tool allow-list, ephemeral, ...). */
	create: (cwd: string, model?: { provider: string; id: string }, options?: SessionCreateOptions) => Promise<string>;
	/** Copy a pi session file into pi's session directory, then show the imported session. */
	importSession: (sourcePath: string, cwd?: string) => Promise<{ sessionId: string; path: string }>;
	rename: (summary: SessionSummary, name: string) => Promise<void>;
	remove: (summary: SessionSummary) => Promise<void>;
	stop: (summary: SessionSummary) => Promise<void>;
	exportHtml: (summary: SessionSummary) => Promise<void>;
	exportJsonl: (summary: SessionSummary) => Promise<void>;
	/** Run a session command against the shown session; failures become toasts. */
	command: (command: SessionCommand) => Promise<unknown>;
	/** Like `command`, but failures are left to the caller (rejects with a TransportError). */
	commandSilent: (command: SessionCommand) => Promise<unknown>;
	/** Clone the shown session into a new file; the host keeps the handle and replaces the transcript. */
	clone: () => Promise<void>;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export const useSessionsStore = create<SessionsStoreState>()((set, get) => ({
	sessions: [],
	projects: [],
	models: [],
	currentSessionId: undefined,
	loaded: false,

	loadAll: async () => {
		await Promise.all([get().loadSessions(), get().loadModels()]);
	},

	loadSessions: async () => {
		const transport = getTransport();
		try {
			const [sessionsData, projectsData] = await Promise.all([
				transport.send({ type: "sessions.list" }),
				transport.send({ type: "projects.list" }),
			]);
			const sessions = pickArray<SessionSummary>(sessionsData, "sessions")
				.slice()
				.sort((a, b) => b.modified - a.modified);
			const projects = pickArray<ProjectInfo>(projectsData, "projects")
				.slice()
				.sort((a, b) => b.lastModified - a.lastModified);
			set({ sessions, projects, loaded: true });
			// The list carries the fresh timestamp of the session on screen, which the user sees.
			markCurrentSeen();
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "sessions.list", message: errorMessage(error) }));
		}
	},

	loadModels: async () => {
		try {
			const data = await getTransport().send({ type: "models.list" });
			set({ models: pickArray<ModelInfo>(data, "models") });
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "models.list", message: errorMessage(error) }));
		}
	},

	refreshModels: async () => {
		try {
			const data = await getTransport().send({ type: "models.refresh" });
			const models = pickArray<ModelInfo>(data, "models");
			set({ models });
			toast("info", t("toast.modelsRefreshed", { count: models.length }));
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "models.refresh", message: errorMessage(error) }));
		}
	},

	select: (sessionId) => {
		const transport = getTransport();
		const previous = get().currentSessionId;
		if (previous && previous !== sessionId) {
			const view = useSessionStore.getState().views[previous];
			const keep = view?.state.isStreaming || view?.runActive;
			if (!keep) transport.unsubscribe(previous);
		}
		set({ currentSessionId: sessionId });
		if (sessionId) {
			useSessionStore.getState().ensure(sessionId);
			if (!transport.isSubscribed(sessionId)) transport.subscribe(sessionId);
			markCurrentSeen();
		}
	},

	open: async (summary) => {
		const sessionId = await resolveHandle(summary);
		get().select(sessionId);
		if (!summary.running) void get().loadSessions();
		return sessionId;
	},

	create: async (cwd, model, options) => {
		const data = await getTransport().send({
			type: "sessions.create",
			cwd,
			...(model ? { model } : {}),
			...(options ? { options } : {}),
		});
		const sessionId = pickString(data, "sessionId", "id");
		if (!sessionId) throw new Error(t("connection.badResult"));
		get().select(sessionId);
		void get().loadSessions();
		return sessionId;
	},

	importSession: async (sourcePath, cwd) => {
		const data = await getTransport().send({ type: "sessions.import", sourcePath, ...(cwd ? { cwd } : {}) });
		const sessionId = pickString(data, "sessionId", "id");
		if (!sessionId) throw new Error(t("connection.badResult"));
		get().select(sessionId);
		void get().loadSessions();
		return { sessionId, path: pickString(data, "path") ?? sourcePath };
	},

	rename: async (summary, name) => {
		const transport = getTransport();
		const sessionId = await resolveHandle(summary);
		await transport.sendSession(sessionId, { type: "setName", name });
		toast("info", t("toast.renamed"));
		await get().loadSessions();
	},

	remove: async (summary) => {
		const transport = getTransport();
		const current = get().currentSessionId;
		// The handle of the shown session, not `summary.id`, addresses the live view.
		if (current && isActiveSummary(summary, current, sessionFileOfHandle(current))) {
			get().select(undefined);
			transport.unsubscribe(current);
			useSessionStore.getState().remove(current);
		}
		await transport.send({ type: "sessions.delete", sessionPath: summary.path });
		toast("info", t("toast.deleted"));
		await get().loadSessions();
	},

	stop: async (summary) => {
		const transport = getTransport();
		// Only offered for running sessions, so this resolves the handle without spawning pi.
		const sessionId = await resolveHandle(summary);
		await transport.send({ type: "sessions.close", sessionId });
		toast("info", t("toast.closed"));
		await get().loadSessions();
	},

	exportHtml: async (summary) => {
		const sessionId = await resolveHandle(summary);
		await exportSessionHtml(sessionId);
	},

	exportJsonl: async (summary) => {
		if (isPendingPath(summary.path)) {
			toast("warning", t("toast.noSessionFile"));
			return;
		}
		await downloadSessionJsonl(summary.path);
	},

	command: async (command) => {
		try {
			return await get().commandSilent(command);
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: command.type, message: errorMessage(error) }));
			throw error;
		}
	},

	commandSilent: async (command) => {
		const sessionId = get().currentSessionId;
		if (!sessionId) throw new TransportError("disconnected", t("connection.disconnected"));
		return getTransport().sendSession(sessionId, command);
	},

	clone: async () => {
		const data = await get().command({ type: "clone" });
		const cancelled = asRecord(data)?.cancelled === true;
		toast("info", cancelled ? t("toast.cloneCancelled") : t("toast.cloned"));
		await get().loadSessions();
	},
}));

function sessionFileOfHandle(sessionId: string): string | undefined {
	return useSessionStore.getState().views[sessionId]?.state.sessionFile;
}

/**
 * Mark the session on screen as seen, so its sidebar circle goes quiet.
 *
 * A session counts as seen while it sits on screen with nothing running in it; the remembered
 * timestamp is the one the list currently reports, so anything that changes the session
 * afterwards (a background run, another client) lights the circle up again. Called when a
 * session becomes the shown one, whenever the list is refreshed and when a run settles.
 */
export function markCurrentSeen(): void {
	const { sessions, currentSessionId } = useSessionsStore.getState();
	if (!currentSessionId) return;
	const view = useSessionStore.getState().views[currentSessionId];
	if (view?.state.isStreaming) return;
	const summary = sessions.find((entry) => isActiveSummary(entry, currentSessionId, view?.state.sessionFile));
	if (!summary || summary.isStreaming) return;
	useUiStore.getState().markSeen(summary.id, summary.modified);
}

async function ensureOpen(summary: SessionSummary): Promise<string> {
	const data = await getTransport().send({ type: "sessions.open", sessionPath: summary.path });
	return pickString(data, "sessionId", "id") ?? summary.id;
}

/**
 * Host handle of a listed session.
 *
 * `summary.handle` is the handle of the live session the host has attached to this file and is
 * authoritative: it differs from `summary.id` for files written by a clone or a fork. Without
 * one, the host resolves (and spawns) the session for the file — except for a session pi has
 * not written yet, whose only address is its id.
 */
async function resolveHandle(summary: SessionSummary): Promise<string> {
	if (summary.handle) return summary.handle;
	if (isPendingPath(summary.path)) return summary.id;
	return ensureOpen(summary);
}

/** pi's `/copy`: put the newest assistant answer of a session on the clipboard. */
export async function copyLastAnswer(sessionId: string): Promise<void> {
	const view = useSessionStore.getState().views[sessionId];
	const text = view ? lastAssistantText(view.messages) : undefined;
	if (!text) {
		toast("warning", t("toast.noAssistantText"));
		return;
	}
	if (await copyText(text)) toast("info", t("toast.copied"));
	else toast("error", t("toast.copyFailed"));
}

/** Fetch a session's raw JSONL from the host and hand it to the browser as a download. */
export async function downloadSessionJsonl(sessionPath: string): Promise<void> {
	try {
		const data = await getTransport().send({ type: "sessions.exportJsonl", sessionPath });
		const record = asRecord(data);
		const content = typeof record?.content === "string" ? record.content : "";
		const fileName = pickString(data, "fileName") ?? "session.jsonl";
		downloadText(fileName, content, "application/x-ndjson");
		toast("info", t("toast.jsonlDownloaded", { fileName }));
	} catch (error) {
		// A session pi has not written yet (fresh fork, no messages) has no file on disk.
		toast("error", t("toast.commandFailed", { command: "sessions.exportJsonl", message: errorMessage(error) }));
		throw error;
	}
}

/** JSONL download for the session on screen; the file may have changed through clone or fork. */
export async function exportSessionJsonl(sessionId: string): Promise<void> {
	const fromState = sessionFileOfHandle(sessionId);
	const summary = useSessionsStore.getState().sessions.find((session) => session.id === sessionId);
	const path = fromState ?? (summary && !isPendingPath(summary.path) ? summary.path : undefined);
	if (!path) {
		toast("warning", t("toast.noSessionFile"));
		return;
	}
	await downloadSessionJsonl(path);
}

/** Export via the host; a returned `html` string is downloaded, a `path` is announced. */
export async function exportSessionHtml(sessionId: string): Promise<void> {
	const data = await getTransport().sendSession(sessionId, { type: "exportHtml" });
	const html = pickString(data, "html");
	if (html) {
		downloadText(`tau-session-${sessionId.slice(0, 8)}.html`, html);
		toast("info", t("toast.exportedDownload"));
		return;
	}
	const path = pickString(data, "path", "outputPath");
	toast("info", path ? t("toast.exported", { path }) : t("toast.exportedDownload"));
}

export function useCurrentSessionId(): string | undefined {
	return useSessionsStore((s) => s.currentSessionId);
}

/** Session file of the shown session, once the host has reported one (changes on clone/fork). */
export function useActiveSessionFile(): string | undefined {
	const currentSessionId = useCurrentSessionId();
	return useSessionStore((s) => (currentSessionId ? s.views[currentSessionId]?.state.sessionFile : undefined));
}
