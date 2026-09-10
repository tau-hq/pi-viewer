import type { ResourceEntry, ResourceKind, ResourceOverview } from "@pi-tau/shared";
import { Boxes } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { getTransport } from "@/transport/transport";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { countEnabled, PACKAGE_SCOPES, parseResources, RESOURCE_KINDS } from "./packages";
import { TrustSection } from "./TrustSection";
import { errorMessage } from "./use-project-cwd";

interface ResourcesTabProps {
	cwd: string | undefined;
	scope: "user" | "project";
	onScopeChange: (scope: "user" | "project") => void;
}

const KIND_LABEL: Record<ResourceKind, () => string> = {
	extensions: () => t("resources.extensions"),
	skills: () => t("resources.skills"),
	prompts: () => t("resources.prompts"),
	themes: () => t("resources.themes"),
};

const SCOPE_LABEL: Record<"user" | "project", () => string> = {
	user: () => t("packages.scopeUser"),
	project: () => t("packages.scopeProject"),
};

function ResourceRow({
	entry,
	busy,
	onToggle,
}: {
	entry: ResourceEntry;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
}) {
	const id = `resource-${entry.kind}-${entry.name}`;
	return (
		<div
			data-testid="resource-row"
			data-kind={entry.kind}
			data-name={entry.name}
			data-enabled={entry.enabled ? "true" : "false"}
			className="flex items-center gap-2 border-border border-b px-3 py-1.5 text-sm last:border-b-0"
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate">
						{entry.name}
					</label>
				</TooltipTrigger>
				<TooltipContent side="top" className="font-mono">
					{entry.path}
				</TooltipContent>
			</Tooltip>
			<span className="shrink-0 truncate text-[11px] text-muted-foreground">
				{entry.origin === "package" ? entry.source : t("resources.discovered")}
			</span>
			<Badge variant="outline">{SCOPE_LABEL[entry.scope]()}</Badge>
			<Switch id={id} checked={entry.enabled} disabled={busy} onCheckedChange={onToggle} />
		</div>
	);
}

/** pi's `config` menu: switch single extensions, skills, prompts and themes on or off. */
export function ResourcesTab({ cwd, scope, onScopeChange }: ResourcesTabProps) {
	const [overview, setOverview] = useState<ResourceOverview | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const load = useCallback(async () => {
		setError(undefined);
		try {
			setOverview(parseResources(await getTransport().send({ type: "resources.list", ...(cwd ? { cwd } : {}) })));
		} catch (loadError) {
			setError(errorMessage(loadError));
			setOverview({ extensions: [], skills: [], prompts: [], themes: [] });
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const toggle = async (entry: ResourceEntry, enabled: boolean) => {
		if (busy) return;
		setBusy(true);
		setError(undefined);
		try {
			const data = await getTransport().send({
				type: "resources.setEnabled",
				kind: entry.kind,
				path: entry.path,
				scope,
				enabled,
				...(cwd ? { cwd } : {}),
			});
			setOverview(parseResources(data));
		} catch (toggleError) {
			setError(errorMessage(toggleError));
		} finally {
			setBusy(false);
		}
	};

	const total = overview ? RESOURCE_KINDS.reduce((sum, kind) => sum + overview[kind].length, 0) : 0;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Boxes className="size-4 text-muted-foreground" />
				<span className="text-muted-foreground text-xs">{t("resources.writeScope")}</span>
				<Tabs value={scope} onValueChange={(value) => onScopeChange(value === "project" ? "project" : "user")}>
					<TabsList>
						{PACKAGE_SCOPES.map((group) => (
							<TabsTrigger
								key={group}
								value={group}
								data-testid={`resources-scope-${group}`}
								disabled={!cwd && group === "project"}
							>
								{SCOPE_LABEL[group]()}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<div className="flex-1" />
				{busy && <Spinner className="size-3.5" />}
			</div>
			<div className="max-h-[34vh] min-h-24 overflow-y-auto rounded-md border border-border">
				{overview === undefined && (
					<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
						<Spinner /> {t("resources.loading")}
					</div>
				)}
				{overview !== undefined && total === 0 && (
					<p data-testid="resources-empty" className="p-6 text-center text-muted-foreground text-sm">
						{t("resources.empty")}
					</p>
				)}
				{overview !== undefined &&
					total > 0 &&
					RESOURCE_KINDS.map((kind) => (
						<div key={kind} data-testid={`resources-group-${kind}`}>
							<div className="flex items-center gap-2 border-border border-b bg-muted/40 px-3 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{KIND_LABEL[kind]()}
								<span className="normal-case">
									{overview[kind].length === 0
										? t("resources.groupEmpty")
										: t("resources.enabledCount", {
												enabled: countEnabled(overview[kind]),
												total: overview[kind].length,
											})}
								</span>
							</div>
							{overview[kind].map((entry) => (
								<ResourceRow
									key={entry.path}
									entry={entry}
									busy={busy}
									onToggle={(enabled) => void toggle(entry, enabled)}
								/>
							))}
						</div>
					))}
			</div>
			{error && (
				<p data-testid="resources-error" className="break-words text-destructive text-xs">
					{error}
				</p>
			)}
			<p className="text-[11px] text-muted-foreground">
				{t("resources.writeHint")} {t("resources.applyNote")} {t("resources.trustNote")}
			</p>
			<TrustSection cwd={cwd} />
		</div>
	);
}
