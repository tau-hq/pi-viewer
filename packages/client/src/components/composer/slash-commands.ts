import type { CommandInfo } from "@pi-tau/shared";
import { t } from "@/i18n";

export type SlashSource = CommandInfo["source"] | "tau";

export interface SlashItem {
	name: string;
	description: string;
	source: SlashSource;
}

/** Commands Tau handles locally by mapping them to protocol commands. */
const TAU_COMMANDS: readonly SlashItem[] = [
	{ name: "compact", description: t("slash.compact"), source: "tau" },
	{ name: "name", description: t("slash.name"), source: "tau" },
	{ name: "export", description: t("slash.export"), source: "tau" },
	{ name: "fork", description: t("slash.fork"), source: "tau" },
	{ name: "model", description: t("slash.model"), source: "tau" },
	{ name: "thinking", description: t("slash.thinking"), source: "tau" },
	{ name: "clear-queue", description: t("slash.clearQueue"), source: "tau" },
	{ name: "tree", description: t("slash.tree"), source: "tau" },
	{ name: "clone", description: t("slash.clone"), source: "tau" },
	{ name: "tools", description: t("slash.tools"), source: "tau" },
	{ name: "commands", description: t("slash.commands"), source: "tau" },
	{ name: "jsonl", description: t("slash.jsonl"), source: "tau" },
	{ name: "copy", description: t("slash.copy"), source: "tau" },
	{ name: "session-settings", description: t("slash.sessionSettings"), source: "tau" },
	{ name: "import", description: t("slash.import"), source: "tau" },
	{ name: "hotkeys", description: t("slash.hotkeys"), source: "tau" },
	{ name: "changelog", description: t("slash.changelog"), source: "tau" },
];

export function parseSlash(text: string): { name: string; args: string } | undefined {
	const match = /^\/([^\s/]+)\s*([\s\S]*)$/.exec(text);
	if (!match) return undefined;
	return { name: match[1] ?? "", args: (match[2] ?? "").trim() };
}

/** Tau built-ins first, then pi's commands (extensions, prompts, skills); names are unique. */
export function mergeCommands(host: readonly CommandInfo[]): SlashItem[] {
	const seen = new Set(TAU_COMMANDS.map((item) => item.name));
	const items: SlashItem[] = [...TAU_COMMANDS];
	for (const command of host) {
		if (seen.has(command.name)) continue;
		seen.add(command.name);
		items.push({ name: command.name, description: command.description ?? "", source: command.source });
	}
	return items;
}

/** Prefix matches first, then substring matches, both in their original order. */
export function filterCommands(items: readonly SlashItem[], query: string): SlashItem[] {
	const q = query.toLowerCase();
	if (!q) return [...items];
	const prefix: SlashItem[] = [];
	const contains: SlashItem[] = [];
	for (const item of items) {
		const name = item.name.toLowerCase();
		if (name.startsWith(q)) prefix.push(item);
		else if (name.includes(q) || item.description.toLowerCase().includes(q)) contains.push(item);
	}
	return [...prefix, ...contains];
}

/** True while the editor text looks like a command name being typed ("/", "/comp"). */
export function isSlashQuery(text: string): boolean {
	return /^\/\S*$/.test(text);
}
