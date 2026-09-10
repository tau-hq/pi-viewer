import type { SessionEvent } from "@pi-tau/shared";
import { t } from "@/i18n";
import { getTransport } from "@/transport/transport";
import { useAuthStore } from "./auth-store";
import { EventConflator } from "./conflator";
import { useConnectionStore } from "./connection-store";
import { useGroupsStore } from "./groups-store";
import { useSessionStore } from "./session-store";
import { markCurrentSeen, useSessionsStore } from "./sessions-store";
import { handleTerminalData, useTerminalStore } from "./terminal-store";
import { toast } from "./ui-store";

/** Side effects of events that are not part of the session view (toasts). */
function announce(event: SessionEvent): void {
	switch (event.type) {
		case "notify":
			toast(event.level, event.message);
			break;
		case "compaction.end":
			if (event.errorMessage) toast("error", t("toast.compactionFailed", { message: event.errorMessage }));
			else if (event.aborted) toast("warning", t("toast.compactionAborted"));
			else toast("info", t("toast.compactionDone"));
			break;
		case "process.exit":
			toast("warning", t("toast.processExit", { code: event.code ?? event.signal ?? "?" }));
			break;
		case "process.error":
			toast("error", t("toast.processError", { message: event.message }));
			break;
		case "retry.end":
			if (!event.success && event.finalError) toast("error", event.finalError);
			break;
		default:
			break;
	}
}

/** Connect the transport to the stores. Returns a disposer. */
export function bootstrap(): () => void {
	const transport = getTransport();
	const sessionStore = useSessionStore.getState();
	const conflator = new EventConflator((sessionId, seq, event) => sessionStore.applyEvent(sessionId, seq, event));

	let reloadTimer: ReturnType<typeof setTimeout> | undefined;
	const scheduleReload = () => {
		if (reloadTimer !== undefined) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			reloadTimer = undefined;
			void useSessionsStore.getState().loadSessions();
			// Groups live on the host, so another browser's change arrives with the same signal.
			void useGroupsStore.getState().load();
		}, 300);
	};

	const offs = [
		// A session created for a group is filed as soon as the list reports its written file.
		useSessionsStore.subscribe((state, previous) => {
			if (state.sessions !== previous.sessions) useGroupsStore.getState().flushDeferred(state.sessions);
		}),
		transport.on("status", (status, attempt) => useConnectionStore.getState().setStatus(status, attempt)),
		transport.on("error", (message) => useConnectionStore.getState().setError(message)),
		transport.on("hello", (host) => {
			useConnectionStore.getState().setHost(host);
			void useSessionsStore.getState().loadAll();
			void useGroupsStore.getState().load();
		}),
		transport.on("snapshot", (sessionId, seq, snapshot) => {
			conflator.flush();
			sessionStore.applySnapshot(sessionId, seq, snapshot);
			// The snapshot reports the session file, which is what pairs the view with its row.
			if (useSessionsStore.getState().currentSessionId === sessionId) markCurrentSeen();
		}),
		transport.on("event", (sessionId, seq, event) => {
			conflator.push(sessionId, seq, event);
			announce(event);
			if (event.type === "process.exit" || event.type === "title.set" || event.type === "state.update") {
				scheduleReload();
			}
			const current = useSessionsStore.getState().currentSessionId === sessionId;
			// A run that settles in the session on screen has been watched, so it counts as seen.
			// The list refresh a moment later marks it again with the timestamp of the new entry.
			if (current && event.type === "run.settled") markCurrentSeen();
			// Background sessions stay subscribed only while they run (sidebar indicator).
			if (!current && (event.type === "run.settled" || event.type === "process.exit")) {
				transport.unsubscribe(sessionId);
			}
		}),
		transport.on("gone", (sessionId, reason) => {
			conflator.flush();
			toast("warning", t("toast.sessionGone", { reason }));
			sessionStore.remove(sessionId);
			const sessions = useSessionsStore.getState();
			if (sessions.currentSessionId === sessionId) sessions.select(undefined);
			scheduleReload();
		}),
		transport.on("sessionsChanged", scheduleReload),
		transport.on("authPrompt", (flowId, promptId, prompt) =>
			useAuthStore.getState().handlePrompt(flowId, promptId, prompt),
		),
		transport.on("authEvent", (flowId, event) => useAuthStore.getState().handleEvent(flowId, event)),
		transport.on("authDone", (flowId, ok, error) => useAuthStore.getState().handleDone(flowId, ok, error)),
		// PTY output goes straight to the xterm instance of its tab, bypassing React.
		transport.on("terminalData", handleTerminalData),
		transport.on("terminalExit", (terminalId, code) => useTerminalStore.getState().markExit(terminalId, code)),
	];

	transport.connect();

	return () => {
		for (const off of offs) off();
		conflator.dispose();
		if (reloadTimer !== undefined) clearTimeout(reloadTimer);
		transport.close();
	};
}
