import type { ThinkingLevel } from "@pi-tau/shared";
import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Levels pi does not spell the way a label should. */
const LABELS: Record<string, string> = { xhigh: "XHigh" };

/**
 * How a thinking level is written in the interface. pi's own value stays lower case
 * everywhere it travels - in commands, in settings files and on the wire.
 */
export function thinkingLabel(level: string): string {
	return LABELS[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}

export function ThinkingPicker({ sessionId }: { sessionId: string }) {
	const level = useSessionStore((s) => s.views[sessionId]?.state.thinkingLevel ?? "off");
	const modelKey = useSessionStore((s) => {
		const model = s.views[sessionId]?.state.model;
		return model ? `${model.provider}/${model.id}` : "";
	});
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	const command = useSessionsStore((s) => s.command);
	const open = useUiStore((s) => s.dialog === "thinking");
	const openDialog = useUiStore((s) => s.openDialog);
	const closeDialog = useUiStore((s) => s.closeDialog);
	// Levels depend on the model: cached per model key and fetched when the menu opens.
	const [cache, setCache] = useState<{ modelKey: string; levels: ThinkingLevel[] } | undefined>(undefined);
	const levels = cache?.modelKey === modelKey ? cache.levels : undefined;
	useEffect(() => {
		if (!open || levels !== undefined) return;
		let cancelled = false;
		command({ type: "getThinkingLevels" })
			.then((data) => {
				if (cancelled) return;
				const list = pickArray<ThinkingLevel>(data, "levels").filter((l) => THINKING_LEVELS.includes(l));
				setCache({ modelKey, levels: list.length > 0 ? list : ["off"] });
			})
			.catch(() => {
				if (!cancelled) setCache({ modelKey, levels: ["off"] });
			});
		return () => {
			cancelled = true;
		};
	}, [open, levels, command, modelKey]);

	return (
		<DropdownMenu open={open} onOpenChange={(next) => (next ? openDialog("thinking") : closeDialog())}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					disabled={!alive}
					className="gap-1.5 font-normal"
					title={t("header.thinking")}
				>
					<Sparkles className="text-muted-foreground" />
					<span className="max-md:hidden">{thinkingLabel(level)}</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-36">
				{(levels ?? [level]).map((item) => (
					<DropdownMenuItem
						key={item}
						checked={item === level}
						onSelect={() => void command({ type: "setThinkingLevel", level: item }).catch(() => undefined)}
					>
						{thinkingLabel(item)}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
