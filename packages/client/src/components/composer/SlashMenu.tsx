import type { CommandInfo } from "@pi-tau/shared";
import { useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions-store";
import { Badge } from "../ui/badge";
import { filterCommands, isSlashQuery, mergeCommands, type SlashItem } from "./slash-commands";

const SOURCE_LABEL: Record<SlashItem["source"], () => string> = {
	tau: () => t("slash.builtin"),
	builtin: () => t("slash.builtin"),
	extension: () => t("slash.extension"),
	prompt: () => t("slash.prompt"),
	skill: () => t("slash.skill"),
};

export interface SlashMenuState {
	open: boolean;
	items: SlashItem[];
	active: number;
	setActive: (index: number) => void;
	move: (delta: number) => void;
}

/** Command list for the composer: Tau built-ins plus pi's commands, fetched once per session. */
export function useSlashMenu(value: string): SlashMenuState {
	const command = useSessionsStore((s) => s.command);
	const open = isSlashQuery(value);
	const [hostCommands, setHostCommands] = useState<CommandInfo[] | undefined>(undefined);
	// The highlight belongs to the query it was made for; a new query starts at the top again.
	const [selection, setSelection] = useState({ query: value, index: 0 });

	useEffect(() => {
		if (!open || hostCommands !== undefined) return;
		let cancelled = false;
		command({ type: "getCommands" })
			.then((data) => {
				if (!cancelled) setHostCommands(pickArray<CommandInfo>(data, "commands"));
			})
			.catch(() => {
				if (!cancelled) setHostCommands([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, hostCommands, command]);

	const items = useMemo(
		() => (open ? filterCommands(mergeCommands(hostCommands ?? []), value.slice(1)) : []),
		[open, hostCommands, value],
	);

	const active = selection.query === value ? Math.min(selection.index, Math.max(0, items.length - 1)) : 0;

	return {
		open,
		items,
		active,
		setActive: (index) => setSelection({ query: value, index }),
		move: (delta) => setSelection({ query: value, index: Math.max(0, Math.min(items.length - 1, active + delta)) }),
	};
}

interface SlashMenuProps {
	menu: SlashMenuState;
	onPick: (item: SlashItem) => void;
}

export function SlashMenu({ menu, onPick }: SlashMenuProps) {
	return (
		<div
			role="listbox"
			className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 animate-in overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
		>
			{menu.items.length === 0 && (
				<p className="px-3 py-3 text-center text-muted-foreground text-xs">{t("slash.noMatch")}</p>
			)}
			{menu.items.map((item, index) => (
				<button
					type="button"
					role="option"
					aria-selected={index === menu.active}
					key={`${item.source}:${item.name}`}
					onMouseEnter={() => menu.setActive(index)}
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onPick(item)}
					className={cn(
						"flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-sm",
						index === menu.active && "bg-accent text-accent-foreground",
					)}
				>
					<span className="w-32 shrink-0 truncate font-mono text-[13px]">/{item.name}</span>
					<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">{item.description}</span>
					<Badge variant="outline">{SOURCE_LABEL[item.source]()}</Badge>
				</button>
			))}
		</div>
	);
}
