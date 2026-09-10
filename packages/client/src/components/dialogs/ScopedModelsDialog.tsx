import type { ConfigScope } from "@pi-tau/shared";
import { ArrowDown, ArrowUp, ListChecks, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickString } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { moveEntry, parseEnabledModels, patchValue, scopedModelRows, toggleEntry } from "./scoped-models";
import { errorMessage, useProjectCwd } from "./use-project-cwd";

/**
 * pi's `enabledModels`: which models the pickers offer and in which order. Written with
 * `settings.patch`, so every other key of settings.json stays untouched.
 */
export function ScopedModelsDialog() {
	const open = useUiStore((s) => s.dialog === "scopedModels");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const models = useSessionsStore((s) => s.models);
	const projectCwd = useProjectCwd();
	const [scope, setScope] = useState<ConfigScope>("global");
	const [entries, setEntries] = useState<string[] | undefined>(undefined);
	const [saved, setSaved] = useState<string[]>([]);
	const [error, setError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		setBusy(true);
		setError(undefined);
		setEntries(undefined);
		try {
			const cwd = scope === "project" ? projectCwd : undefined;
			const data = await getTransport().send({ type: "config.read", file: "settings", scope, ...(cwd ? { cwd } : {}) });
			const current = parseEnabledModels(pickString(data, "content") ?? "");
			setEntries(current);
			setSaved(current);
		} catch (loadError) {
			setError(errorMessage(loadError));
			setEntries([]);
		} finally {
			setBusy(false);
		}
	}, [scope, projectCwd]);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const save = async () => {
		if (!entries) return;
		setBusy(true);
		setError(undefined);
		try {
			const cwd = scope === "project" ? projectCwd : undefined;
			const data = await getTransport().send({
				type: "settings.patch",
				scope,
				...(cwd ? { cwd } : {}),
				patch: { enabledModels: patchValue(entries, models) },
			});
			setSaved(entries);
			toast("info", t("scopedModels.saved", { path: pickString(data, "path") ?? "settings.json" }));
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setBusy(false);
		}
	};

	const rows = scopedModelRows(entries ?? [], models);
	const dirty = entries !== undefined && JSON.stringify(entries) !== JSON.stringify(saved);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="scoped-models-dialog" size="lg">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<ListChecks className="size-4 text-muted-foreground" />
						<DialogTitle>{t("scopedModels.title")}</DialogTitle>
					</div>
					<DialogDescription>{t("scopedModels.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center gap-2">
					<Tabs value={scope} onValueChange={(value) => setScope(value as ConfigScope)}>
						<TabsList>
							<TabsTrigger value="global">{t("config.global")}</TabsTrigger>
							<TabsTrigger value="project" disabled={!projectCwd}>
								{t("config.project")}
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<div className="flex-1" />
					{entries && <Badge variant="outline">{t("scopedModels.selected", { count: entries.length })}</Badge>}
					{busy && <Spinner />}
				</div>
				<div className="max-h-[45vh] overflow-y-auto rounded-md border border-border">
					{entries === undefined && (
						<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
							<Spinner /> {t("scopedModels.loading")}
						</div>
					)}
					{entries && rows.length === 0 && (
						<p className="p-6 text-center text-muted-foreground text-sm">{t("scopedModels.empty")}</p>
					)}
					{rows.map((row) => (
						<div
							key={row.key}
							data-testid="scoped-model-row"
							data-selected={row.selected ? "true" : "false"}
							className={cn(
								"flex items-center gap-2 border-border border-b px-3 py-1.5 text-sm last:border-b-0",
								row.selected && "bg-accent/30",
							)}
						>
							<input
								type="checkbox"
								aria-label={row.model?.name ?? row.key}
								checked={row.selected}
								className="size-4 shrink-0 accent-primary"
								onChange={() => setEntries((current) => toggleEntry(current ?? [], row.key))}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate">{row.model?.name ?? row.key}</span>
								<span className="block truncate font-mono text-[11px] text-muted-foreground">{row.key}</span>
							</span>
							{!row.model && <Badge variant="warning">{t("scopedModels.missing")}</Badge>}
							{row.selected && (
								<span className="flex shrink-0 items-center">
									<IconButton
										size="iconSm"
										label={t("scopedModels.up")}
										icon={<ArrowUp />}
										disabled={row.index === 0}
										onClick={() => setEntries((current) => moveEntry(current ?? [], row.index, -1))}
									/>
									<IconButton
										size="iconSm"
										label={t("scopedModels.down")}
										icon={<ArrowDown />}
										disabled={row.index === (entries?.length ?? 0) - 1}
										onClick={() => setEntries((current) => moveEntry(current ?? [], row.index, 1))}
									/>
								</span>
							)}
						</div>
					))}
				</div>
				{error && (
					<p data-testid="scoped-models-error" className="break-words text-destructive text-xs">
						{error}
					</p>
				)}
				<div className="flex items-center gap-2">
					<p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
						{entries?.length === 0 ? t("scopedModels.none") : t("scopedModels.applyNote")}
					</p>
					<Button data-testid="scoped-models-save" disabled={busy || !dirty} onClick={() => void save()}>
						<Save />
						{busy ? t("scopedModels.saving") : t("scopedModels.save")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
