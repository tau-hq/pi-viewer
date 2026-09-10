import type { CommandInfo } from "@pi-tau/shared";

export type CommandSource = CommandInfo["source"];

/** Display order of the groups; unknown sources fall into the last one. */
export const COMMAND_SOURCES: readonly CommandSource[] = ["extension", "prompt", "skill", "builtin"];

export interface CommandGroup {
	source: CommandSource;
	commands: CommandInfo[];
}

/** Commands grouped by source, sorted by name; empty groups are dropped. */
export function groupCommands(commands: readonly CommandInfo[]): CommandGroup[] {
	const known = new Set<string>(COMMAND_SOURCES);
	const buckets = new Map<CommandSource, CommandInfo[]>();
	for (const command of commands) {
		if (typeof command?.name !== "string" || command.name.length === 0) continue;
		const source = known.has(command.source) ? command.source : "builtin";
		const list = buckets.get(source);
		if (list) list.push(command);
		else buckets.set(source, [command]);
	}
	return COMMAND_SOURCES.flatMap((source) => {
		const list = buckets.get(source);
		if (!list) return [];
		return [{ source, commands: [...list].sort((a, b) => a.name.localeCompare(b.name)) }];
	});
}
