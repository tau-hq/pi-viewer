import type { TreeNode } from "@pi-tau/shared";
import { ChevronRight, Tag } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/i18n";
import { pickArray, pickString } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import {
	countNodes,
	filterTree,
	flattenTree,
	initialCollapsed,
	type JumpTarget,
	jumpTarget,
	markActivePath,
	TREE_FILTERS,
	type TreeFilter,
	type TreeRow,
	typeLabel,
} from "./tree";

const FILTER_LABEL: Record<TreeFilter, () => string> = {
	all: () => t("tree.filterAll"),
	"no-tools": () => t("tree.filterNoToolResults"),
	"user-only": () => t("tree.filterUserOnly"),
	"labeled-only": () => t("tree.filterLabeled"),
};

interface TreeState {
	tree: TreeNode[];
	leafId: string | undefined;
}

function timeOf(timestamp: string): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

interface RowProps {
	row: TreeRow;
	collapsed: boolean;
	current: boolean;
	/** Where picking the row goes; undefined for rows that are only there to be read. */
	target: JumpTarget | undefined;
	disabled: boolean;
	onToggle: () => void;
	onSelect: () => void;
	scrollIntoView: boolean;
}

function Row({ row, collapsed, current, target, disabled, onToggle, onSelect, scrollIntoView }: RowProps) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (scrollIntoView) ref.current?.scrollIntoView({ block: "center" });
	}, [scrollIntoView]);
	const { node } = row;
	return (
		<div
			ref={ref}
			data-testid="tree-row"
			data-active={node.onActivePath ? "true" : undefined}
			data-jump={target?.kind}
			className={cn(
				"flex items-center gap-1.5 border-l-2 py-0.5 pr-2 text-sm",
				node.onActivePath ? "border-primary" : "border-transparent",
			)}
			style={{ paddingLeft: `${row.depth * 16 + 6}px` }}
		>
			<button
				type="button"
				onClick={onToggle}
				disabled={!row.collapsible}
				aria-label={collapsed ? t("tree.expand") : t("tree.collapse")}
				className={cn(
					"flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent",
					!row.collapsible && "invisible",
				)}
			>
				<ChevronRight className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")} />
			</button>
			<button
				type="button"
				onClick={onSelect}
				disabled={disabled || current || !target}
				title={target?.kind === "beforeMessage" ? t("tree.jumpBefore") : target ? t("tree.jumpEnd") : undefined}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left disabled:cursor-default",
					target && !current && "hover:bg-accent",
					node.onActivePath ? "text-foreground" : "text-muted-foreground",
					!target && !current && "opacity-55",
					current && "bg-accent/60",
				)}
			>
				<span className="w-20 shrink-0 truncate text-[11px] uppercase tracking-wide">{typeLabel(node)}</span>
				{node.label && (
					<Badge variant="outline" data-testid="tree-label" className="shrink-0 font-medium">
						<Tag />
						{node.label}
					</Badge>
				)}
				<span className="min-w-0 flex-1 truncate">{node.preview.replace(/\s+/g, " ") || t("tree.untitled")}</span>
				{target?.kind === "branchEnd" && !current && (
					<Badge variant="outline" data-testid="tree-branch-end" className="shrink-0">
						{t("tree.branchEnd")}
					</Badge>
				)}
				{current && <Badge variant="default">{t("tree.current")}</Badge>}
				<span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{timeOf(node.timestamp)}</span>
			</button>
		</div>
	);
}

/** Session tree with branch navigation (`navigateTree`); the host then replaces the transcript. */
export function TreeDialog() {
	const open = useUiStore((s) => s.dialog === "tree");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const command = useSessionsStore((s) => s.command);
	const [state, setState] = useState<TreeState | undefined>(undefined);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [summarize, setSummarize] = useState(false);
	const [filter, setFilter] = useState<TreeFilter>("all");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setState(undefined);
		setBusy(false);
		setSummarize(false);
		setFilter("all");
		let cancelled = false;
		command({ type: "getTree" })
			.then((data) => {
				if (cancelled) return;
				const leafId = pickString(data, "leafId");
				const tree = markActivePath(pickArray<TreeNode>(data, "tree"), leafId);
				setCollapsed(initialCollapsed(tree));
				setState({ tree, leafId });
			})
			.catch(() => {
				if (!cancelled) setState({ tree: [], leafId: undefined });
			});
		return () => {
			cancelled = true;
		};
	}, [open, command]);

	const visible = useMemo(() => (state ? filterTree(state.tree, filter) : []), [state, filter]);
	const rows = useMemo(() => flattenTree(visible, collapsed), [visible, collapsed]);
	const total = useMemo(() => (state ? countNodes(state.tree) : 0), [state]);

	const toggle = (id: string) =>
		setCollapsed((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});

	const select = async (node: TreeNode) => {
		const target = jumpTarget(node);
		if (busy || !target) return;
		setBusy(true);
		try {
			await command({ type: "navigateTree", entryId: target.entryId, ...(summarize ? { summarize: true } : {}) });
			closeDialog();
			toast("info", t("tree.navigated"));
		} catch {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent size="lg" data-testid="tree-dialog">
				<DialogHeader>
					<DialogTitle>{t("tree.title")}</DialogTitle>
					<DialogDescription>{t("tree.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center gap-2">
					<Tabs value={filter} onValueChange={(value) => setFilter(value as TreeFilter)}>
						<TabsList aria-label={t("tree.filter")}>
							{TREE_FILTERS.map((item) => (
								<TabsTrigger key={item} value={item} data-testid={`tree-filter-${item}`}>
									{FILTER_LABEL[item]()}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					<div className="flex-1" />
					{state && (
						<span className="text-[11px] text-muted-foreground tabular-nums" data-testid="tree-count">
							{t("tree.counted", { shown: countNodes(visible), total })}
						</span>
					)}
				</div>
				<div className="max-h-[55vh] overflow-y-auto rounded-md border border-border py-1">
					{state === undefined && (
						<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
							<Spinner /> {t("tree.loading")}
						</div>
					)}
					{state && rows.length === 0 && (
						<p data-testid="tree-empty" className="p-6 text-center text-muted-foreground text-sm">
							{filter === "all" ? t("tree.empty") : t("tree.filterEmpty")}
						</p>
					)}
					{rows.map((row) => (
						<Row
							key={row.node.id}
							row={row}
							collapsed={collapsed.has(row.node.id)}
							current={row.node.id === state?.leafId}
							target={jumpTarget(row.node)}
							disabled={busy}
							onToggle={() => toggle(row.node.id)}
							onSelect={() => void select(row.node)}
							scrollIntoView={row.node.id === state?.leafId}
						/>
					))}
				</div>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={summarize}
						onChange={(e) => setSummarize(e.target.checked)}
						className="size-4 accent-primary"
					/>
					{t("tree.summarize")}
					{busy && <Spinner className="ml-auto size-3.5" />}
				</label>
				<p className="text-[11px] text-muted-foreground">{t("tree.labels")}</p>
			</DialogContent>
		</Dialog>
	);
}
