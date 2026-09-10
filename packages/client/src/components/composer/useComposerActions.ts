import type { ImageInput, ThinkingLevel } from "@pi-tau/shared";
import { useCallback } from "react";
import { t } from "@/i18n";
import { parseBashResult } from "@/lib/result-data";
import { useSessionStore } from "@/store/session-store";
import { copyLastAnswer, exportSessionHtml, exportSessionJsonl, useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { THINKING_LEVELS } from "../header/ThinkingPicker";

export interface ComposerActions {
	/** Send text as prompt, or steer/follow-up while a run is active. */
	submitPrompt: (text: string, images: ImageInput[], followUp: boolean) => void;
	/** Run a `!command` (`!!` keeps it out of the model context). */
	runBash: (text: string) => void;
	/** Execute a Tau built-in; false when the command is not handled locally. */
	runSlash: (name: string, args: string) => boolean;
	abort: () => void;
}

export function useComposerActions(sessionId: string): ComposerActions {
	const command = useSessionsStore((s) => s.command);
	const clone = useSessionsStore((s) => s.clone);
	const openDialog = useUiStore((s) => s.openDialog);

	const submitPrompt = useCallback<ComposerActions["submitPrompt"]>(
		(text, images, followUp) => {
			const view = useSessionStore.getState().views[sessionId];
			const running = !!view && (view.runActive || view.state.isStreaming);
			const payload = images.length > 0 ? { message: text, images } : { message: text };
			const type = running ? (followUp ? "followUp" : "steer") : "prompt";
			void command({ type, ...payload }).catch(() => undefined);
		},
		[command, sessionId],
	);

	const runBash = useCallback<ComposerActions["runBash"]>(
		(text) => {
			const excludeFromContext = text.startsWith("!!");
			const shell = text.replace(/^!!?/, "").trim();
			if (!shell) return;
			const store = useSessionStore.getState();
			store.startBashRun(sessionId, shell);
			void command({ type: "bash", command: shell, ...(excludeFromContext ? { excludeFromContext } : {}) })
				.then((data) => useSessionStore.getState().endBashRun(sessionId, parseBashResult(data)))
				.catch(() => useSessionStore.getState().endBashRun(sessionId));
		},
		[command, sessionId],
	);

	const runSlash = useCallback<ComposerActions["runSlash"]>(
		(name, args) => {
			switch (name) {
				case "compact":
					if (args) void command({ type: "compact", customInstructions: args }).catch(() => undefined);
					else openDialog("compact");
					return true;
				case "name":
					if (args) void command({ type: "setName", name: args }).catch(() => undefined);
					else openDialog("rename");
					return true;
				case "export":
					void exportSessionHtml(sessionId).catch(() => undefined);
					return true;
				case "jsonl":
					void exportSessionJsonl(sessionId).catch(() => undefined);
					return true;
				case "commands":
					openDialog("commands");
					return true;
				case "copy":
					void copyLastAnswer(sessionId).catch(() => undefined);
					return true;
				case "session-settings":
					openDialog("sessionSettings");
					return true;
				case "import":
					openDialog("importSession");
					return true;
				case "hotkeys":
					openDialog("hotkeys");
					return true;
				case "changelog":
					openDialog("changelog");
					return true;
				case "fork":
					openDialog("fork");
					return true;
				case "tree":
					openDialog("tree");
					return true;
				case "tools":
					openDialog("tools");
					return true;
				case "clone":
					void clone().catch(() => undefined);
					return true;
				case "model": {
					const query = args.toLowerCase();
					const models = useSessionsStore.getState().models;
					const match = query
						? (models.find((m) => m.id.toLowerCase() === query) ??
							models.find((m) => `${m.provider}/${m.id}`.toLowerCase() === query) ??
							models.find((m) => m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)))
						: undefined;
					if (match)
						void command({ type: "setModel", provider: match.provider, modelId: match.id }).catch(() => undefined);
					else openDialog("model");
					return true;
				}
				case "thinking": {
					const level = args.toLowerCase() as ThinkingLevel;
					if (THINKING_LEVELS.includes(level)) void command({ type: "setThinkingLevel", level }).catch(() => undefined);
					else openDialog("thinking");
					return true;
				}
				case "clear-queue":
					void command({ type: "clearQueue" })
						.then(() => toast("info", t("toast.queueCleared")))
						.catch(() => undefined);
					return true;
				default:
					return false;
			}
		},
		[command, clone, openDialog, sessionId],
	);

	const abort = useCallback(() => {
		void command({ type: "abort" }).catch(() => undefined);
	}, [command]);

	return { submitPrompt, runBash, runSlash, abort };
}
