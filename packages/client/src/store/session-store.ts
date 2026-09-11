import type {
	Message,
	ModelInfo,
	SessionEvent,
	SessionSnapshot,
	ThinkingLevel,
	ToolResultMessage,
	ToolRun,
} from "@pi-tau/shared";
import { create } from "zustand";
import {
	applySessionEvent,
	applySnapshot,
	type BashResult,
	createSessionView,
	indexToolResults,
	type SessionView,
} from "./session-reducer";

/** What `sessions.preview` gives the client: the file's conversation, without a process. */
export interface SessionPreview {
	messages: Message[];
	leafId?: string;
	cwd?: string;
	model?: ModelInfo;
	thinkingLevel?: ThinkingLevel;
}

interface SessionStoreState {
	views: Record<string, SessionView>;
	ensure: (sessionId: string) => void;
	applySnapshot: (sessionId: string, seq: number, snapshot: SessionSnapshot) => void;
	/** The session file's conversation, shown while pi starts; a snapshot always wins over it. */
	applyPreview: (sessionId: string, preview: SessionPreview) => void;
	applyEvent: (sessionId: string, seq: number, event: SessionEvent) => void;
	remove: (sessionId: string) => void;
	/** Remember the command of a `!` run so the live output card can show it. */
	startBashRun: (sessionId: string, command: string) => void;
	/** With a result the card turns into a finished one; without, the run is dropped (failure). */
	endBashRun: (sessionId: string, result?: BashResult) => void;
}

export const useSessionStore = create<SessionStoreState>()((set, get) => ({
	views: {},
	ensure: (sessionId) => {
		if (get().views[sessionId]) return;
		set((s) => ({ views: { ...s.views, [sessionId]: createSessionView(sessionId) } }));
	},
	applyPreview: (sessionId, preview) =>
		set((s) => {
			const view = s.views[sessionId] ?? createSessionView(sessionId);
			// The process won the race; its transcript is the authoritative one.
			if (view.loaded) return s;
			const state = { ...view.state, processAlive: false };
			if (preview.cwd !== undefined) state.cwd = preview.cwd;
			if (preview.model !== undefined) state.model = preview.model;
			if (preview.thinkingLevel !== undefined) state.thinkingLevel = preview.thinkingLevel;
			return {
				views: {
					...s.views,
					[sessionId]: {
						...view,
						attaching: true,
						messages: preview.messages,
						leafId: preview.leafId,
						toolResults: indexToolResults(preview.messages),
						state,
					},
				},
			};
		}),
	applySnapshot: (sessionId, seq, snapshot) =>
		set((s) => ({ views: { ...s.views, [sessionId]: applySnapshot(s.views[sessionId], seq, snapshot) } })),
	applyEvent: (sessionId, seq, event) =>
		set((s) => {
			const current = s.views[sessionId] ?? createSessionView(sessionId);
			const next = applySessionEvent(current, event);
			if (next === current && seq <= current.lastSeq) return s;
			return { views: { ...s.views, [sessionId]: { ...next, lastSeq: Math.max(seq, current.lastSeq) } } };
		}),
	remove: (sessionId) =>
		set((s) => {
			if (!(sessionId in s.views)) return s;
			const { [sessionId]: _removed, ...rest } = s.views;
			return { views: rest };
		}),
	startBashRun: (sessionId, command) =>
		set((s) => {
			const view = s.views[sessionId];
			if (!view) return s;
			return {
				views: {
					...s.views,
					[sessionId]: { ...view, bashRun: { commandId: "", command, output: "", startedAt: Date.now() } },
				},
			};
		}),
	endBashRun: (sessionId, result) =>
		set((s) => {
			const view = s.views[sessionId];
			if (!view?.bashRun) return s;
			const bashRun = result ? { ...view.bashRun, output: result.output, result } : undefined;
			return { views: { ...s.views, [sessionId]: { ...view, bashRun } } };
		}),
}));

export function useToolResult(sessionId: string, toolCallId: string): ToolResultMessage | undefined {
	return useSessionStore((s) => s.views[sessionId]?.toolResults[toolCallId]);
}

export function useToolRun(sessionId: string, toolCallId: string): ToolRun | undefined {
	return useSessionStore((s) => s.views[sessionId]?.activeTools.find((run) => run.toolCallId === toolCallId));
}
