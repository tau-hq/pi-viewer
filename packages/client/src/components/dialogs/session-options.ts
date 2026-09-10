import type { SessionCreateOptions, ThinkingLevel } from "@pi-tau/shared";

/** Form state of the advanced section; empty strings mean "leave it to pi". */
export interface AdvancedOptionsState {
	systemPrompt: string;
	appendSystemPrompt: string;
	/** Only when true is `tools` sent at all, so an empty list can mean "no tools". */
	restrictTools: boolean;
	tools: string[];
	excludeTools: string[];
	extensions: string[];
	noContextFiles: boolean;
	ephemeral: boolean;
	thinkingLevel: ThinkingLevel | "";
}

export const EMPTY_ADVANCED_OPTIONS: AdvancedOptionsState = {
	systemPrompt: "",
	appendSystemPrompt: "",
	restrictTools: false,
	tools: [],
	excludeTools: [],
	extensions: [],
	noContextFiles: false,
	ephemeral: false,
	thinkingLevel: "",
};

/**
 * Map the form onto `SessionCreateOptions`. Returns undefined when nothing was chosen, so the
 * simple path sends `sessions.create` exactly as before.
 */
export function buildSessionOptions(state: AdvancedOptionsState): SessionCreateOptions | undefined {
	const options: SessionCreateOptions = {};
	const systemPrompt = state.systemPrompt.trim();
	const appendSystemPrompt = state.appendSystemPrompt.trim();
	const extensions = state.extensions.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
	if (systemPrompt.length > 0) options.systemPrompt = systemPrompt;
	if (appendSystemPrompt.length > 0) options.appendSystemPrompt = appendSystemPrompt;
	if (state.restrictTools) options.tools = [...state.tools];
	if (state.excludeTools.length > 0) options.excludeTools = [...state.excludeTools];
	if (extensions.length > 0) options.extensions = extensions;
	if (state.noContextFiles) options.noContextFiles = true;
	if (state.ephemeral) options.ephemeral = true;
	if (state.thinkingLevel !== "") options.thinkingLevel = state.thinkingLevel;
	return Object.keys(options).length === 0 ? undefined : options;
}

/** How many advanced options are set; shown on the collapsed section. */
export function countAdvancedOptions(state: AdvancedOptionsState): number {
	const options = buildSessionOptions(state);
	return options ? Object.keys(options).length : 0;
}

export function replaceAt(entries: readonly string[], index: number, value: string): string[] {
	return entries.map((entry, at) => (at === index ? value : entry));
}

export function removeAt(entries: readonly string[], index: number): string[] {
	return entries.filter((_entry, at) => at !== index);
}
