import type { ModelInfo } from "@pi-tau/shared";
import { Brain, Check, ChevronDown, Cpu, KeyRound, RefreshCw } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Spinner } from "../ui/spinner";

interface ModelMenuProps {
	models: ModelInfo[];
	current: ModelInfo | undefined;
	onSelect: (model: ModelInfo | undefined) => void;
	placeholder?: string;
	allowClear?: boolean;
	disabled?: boolean;
	/** Controlled open state (used by the /model slash command). */
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	/** Icon-only trigger on narrow layouts. */
	compact?: boolean;
	/** Shows a footer entry that leads to the providers dialog. */
	onManageProviders?: () => void;
}

interface Group {
	provider: string;
	models: ModelInfo[];
}

function groupByProvider(models: ModelInfo[], query: string): Group[] {
	const q = query.trim().toLowerCase();
	const groups = new Map<string, ModelInfo[]>();
	for (const model of models) {
		if (q && !`${model.provider} ${model.id} ${model.name}`.toLowerCase().includes(q)) continue;
		const list = groups.get(model.provider);
		if (list) list.push(model);
		else groups.set(model.provider, [model]);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([provider, list]) => ({ provider, models: list }));
}

/** Searchable model picker grouped by provider. */
export function ModelMenu({
	models,
	current,
	onSelect,
	placeholder,
	allowClear,
	disabled,
	open,
	onOpenChange,
	className,
	compact,
	onManageProviders,
}: ModelMenuProps) {
	const [internalOpen, setInternalOpen] = useState(false);
	const isOpen = open ?? internalOpen;
	const setOpen = (next: boolean) => {
		setInternalOpen(next);
		onOpenChange?.(next);
	};
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [refreshing, setRefreshing] = useState(false);
	const refreshModels = useSessionsStore((s) => s.refreshModels);
	useEffect(() => {
		if (isOpen) {
			setQuery("");
			setActive(0);
		}
	}, [isOpen]);

	const refresh = () => {
		if (refreshing) return;
		setRefreshing(true);
		void refreshModels().finally(() => setRefreshing(false));
	};

	const groups = useMemo(() => groupByProvider(models, query), [models, query]);
	const flat = useMemo(() => groups.flatMap((group) => group.models), [groups]);

	const choose = (model: ModelInfo | undefined) => {
		onSelect(model);
		setOpen(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((i) => Math.min(flat.length - 1, i + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((i) => Math.max(0, i - 1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			const model = flat[active];
			if (model) choose(model);
		}
	};

	return (
		<Popover open={isOpen} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" disabled={disabled} className={cn("max-w-64 gap-1.5 font-normal", className)}>
					{current?.reasoning ? <Brain className="text-foreground/70" /> : <Cpu className="text-muted-foreground" />}
					<span className={cn("truncate", compact && "max-md:hidden")}>
						{current ? current.name : (placeholder ?? t("header.noModel"))}
					</span>
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 p-0">
				<div className="flex items-center gap-1 border-border border-b p-2">
					<input
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
						onKeyDown={onKeyDown}
						placeholder={t("header.model")}
						className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring"
					/>
					{refreshing ? (
						<span className="flex size-7 items-center justify-center">
							<Spinner className="size-3.5" />
						</span>
					) : (
						<IconButton
							size="iconSm"
							data-testid="models-refresh"
							label={t("header.refreshModels")}
							icon={<RefreshCw />}
							onClick={refresh}
						/>
					)}
				</div>
				<div className="max-h-80 overflow-y-auto p-1">
					{allowClear && (
						<button
							type="button"
							onClick={() => choose(undefined)}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:bg-accent"
						>
							<span className="flex size-4 items-center justify-center">
								{!current && <Check className="size-3.5" />}
							</span>
							{placeholder ?? t("newSession.defaultModel")}
						</button>
					)}
					{groups.map((group) => (
						<div key={group.provider}>
							<div className="px-2 pt-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{group.provider}
							</div>
							{group.models.map((model) => {
								const index = flat.indexOf(model);
								const selected = current?.id === model.id && current.provider === model.provider;
								return (
									<button
										type="button"
										key={`${model.provider}/${model.id}`}
										onMouseEnter={() => setActive(index)}
										onClick={() => choose(model)}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
											index === active && "bg-accent text-accent-foreground",
										)}
									>
										<span className="flex size-4 shrink-0 items-center justify-center">
											{selected && <Check className="size-3.5" />}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block truncate">{model.name}</span>
											{model.name !== model.id && (
												<span className="block truncate text-[11px] text-muted-foreground">{model.id}</span>
											)}
										</span>
										{model.reasoning && (
											<Badge variant="default">
												<Brain />
												{t("header.reasoning")}
											</Badge>
										)}
									</button>
								);
							})}
						</div>
					))}
					{flat.length === 0 && (
						<p className="px-2 py-4 text-center text-muted-foreground text-xs">{t("slash.noMatch")}</p>
					)}
				</div>
				{onManageProviders && (
					<div className="border-border border-t p-1">
						<button
							type="button"
							data-testid="manage-providers"
							onClick={() => {
								setOpen(false);
								onManageProviders();
							}}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
						>
							<KeyRound className="size-3.5 text-muted-foreground" />
							{t("providers.manage")}
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
