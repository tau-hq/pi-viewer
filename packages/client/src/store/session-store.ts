import type { SessionEvent, SessionSnapshot, ToolResultMessage, ToolRun } from "@pi-tau/shared";
import { create } from "zustand";
import {
	applySessionEvent,
	applySnapshot,
	type BashResult,
	createSessionView,
	type SessionView,
} from "./session-reducer";

interface SessionStoreState {
	views: Record<string, SessionView>;
	ensure: (sessionId: string) => void;
	applySnapshot: (sessionId: string, seq: number, snapshot: SessionSnapshot) => void;
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
