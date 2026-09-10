import type { HostCommand, PackageEntry } from "@pi-tau/shared";
import { Download, Package, RefreshCw, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { toast } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { looksLikePackageSource, PACKAGE_SCOPES, packagesOfScope, parsePackages } from "./packages";
import { errorMessage } from "./use-project-cwd";

interface PackagesTabProps {
	cwd: string | undefined;
	scope: "user" | "project";
	onScopeChange: (scope: "user" | "project") => void;
}

const SCOPE_LABEL: Record<"user" | "project", () => string> = {
	user: () => t("packages.scopeUser"),
	project: () => t("packages.scopeProject"),
};

interface RowProps {
	entry: PackageEntry;
	busy: string | undefined;
	onUpdate: () => void;
	onRemove: () => void;
}

function PackageRow({ entry, busy, onUpdate, onRemove }: RowProps) {
	const mine = busy === `update:${entry.source}` || busy === `remove:${entry.source}`;
	return (
		<div
			data-testid="package-row"
			data-source={entry.source}
			className="flex items-center gap-2 border-border border-b px-3 py-2 text-sm last:border-b-0"
		>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-mono text-[13px]">{entry.source}</span>
				{entry.installedPath && (
					<span className="block truncate font-mono text-[11px] text-muted-foreground">{entry.installedPath}</span>
				)}
			</span>
			{!entry.installed && (
				<Badge variant="outline" title={t("packages.notInstalledHint")} className="text-warning">
					{t("packages.notInstalled")}
				</Badge>
			)}
			{entry.filtered && (
				<Badge variant="outline" title={t("packages.filteredHint")}>
					{t("packages.filtered")}
				</Badge>
			)}
			{mine && <Spinner className="size-3.5" />}
			<Button size="sm" variant="ghost" data-testid="package-update" disabled={busy !== undefined} onClick={onUpdate}>
				<RefreshCw />
				{t("packages.update")}
			</Button>
			<Button size="sm" variant="outline" data-testid="package-remove" disabled={busy !== undefined} onClick={onRemove}>
				<Trash2 />
				{t("packages.remove")}
			</Button>
		</div>
	);
}

/** pi's `install/remove/list/update`: the packages that ship extensions, skills and prompts. */
export function PackagesTab({ cwd, scope, onScopeChange }: PackagesTabProps) {
	const [entries, setEntries] = useState<PackageEntry[] | undefined>(undefined);
	const [source, setSource] = useState("");
	const [busy, setBusy] = useState<string | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);

	const load = useCallback(async () => {
		setError(undefined);
		try {
			setEntries(parsePackages(await getTransport().send({ type: "packages.list", ...(cwd ? { cwd } : {}) })));
		} catch (loadError) {
			setError(errorMessage(loadError));
			setEntries([]);
		}
	}, [cwd]);

	useEffect(() => {
		void load();
	}, [load]);

	/** Every mutation answers with the new list, so one helper covers install, remove and update. */
	const run = async (label: string, command: HostCommand, done: string): Promise<boolean> => {
		if (busy) return false;
		setBusy(label);
		setError(undefined);
		try {
			setEntries(parsePackages(await getTransport().send(command)));
			toast("info", done);
			return true;
		} catch (runError) {
			setError(errorMessage(runError));
			return false;
		} finally {
			setBusy(undefined);
		}
	};

	const install = async (event: FormEvent) => {
		event.preventDefault();
		const value = source.trim();
		if (!looksLikePackageSource(value)) {
			setError(t("packages.invalidSource"));
			return;
		}
		const command: HostCommand = { type: "packages.install", source: value, scope, ...(cwd ? { cwd } : {}) };
		if (await run("install", command, t("packages.installed", { source: value }))) setSource("");
	};

	const total = entries?.length ?? 0;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<Package className="size-4 text-muted-foreground" />
				{entries && <Badge variant="outline">{t("packages.count", { count: total })}</Badge>}
				{busy === "updateAll" && <Spinner className="size-3.5" />}
				<div className="flex-1" />
				<Button
					size="sm"
					variant="ghost"
					data-testid="packages-update-all"
					disabled={busy !== undefined || total === 0}
					onClick={() =>
						void run("updateAll", { type: "packages.update", ...(cwd ? { cwd } : {}) }, t("packages.updated"))
					}
				>
					<RefreshCw />
					{t("packages.updateAll")}
				</Button>
			</div>
			<div className="max-h-[34vh] min-h-24 overflow-y-auto rounded-md border border-border">
				{entries === undefined && (
					<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
						<Spinner /> {t("packages.loading")}
					</div>
				)}
				{entries?.length === 0 && (
					<div data-testid="packages-empty" className="p-6 text-center text-sm">
						<p className="text-muted-foreground">{t("packages.empty")}</p>
						<p className="mt-1 text-[11px] text-muted-foreground">{t("packages.emptyHint")}</p>
					</div>
				)}
				{entries !== undefined &&
					PACKAGE_SCOPES.map((group) => {
						const rows = packagesOfScope(entries, group);
						if (rows.length === 0) return null;
						return (
							<div key={group} data-testid={`packages-group-${group}`}>
								<div className="border-border border-b bg-muted/40 px-3 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
									{SCOPE_LABEL[group]()}
								</div>
								{rows.map((entry) => (
									<PackageRow
										key={`${entry.scope}:${entry.source}`}
										entry={entry}
										busy={busy}
										onUpdate={() =>
											void run(
												`update:${entry.source}`,
												{ type: "packages.update", source: entry.source, ...(cwd ? { cwd } : {}) },
												t("packages.updated"),
											)
										}
										onRemove={() =>
											void run(
												`remove:${entry.source}`,
												{ type: "packages.remove", source: entry.source, scope: entry.scope, ...(cwd ? { cwd } : {}) },
												t("packages.removed", { source: entry.source }),
											)
										}
									/>
								))}
							</div>
						);
					})}
			</div>
			<form onSubmit={(event) => void install(event)} className="flex flex-col gap-1.5">
				<label htmlFor="packages-source" className="text-muted-foreground text-xs">
					{t("packages.addLabel")}
				</label>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						id="packages-source"
						data-testid="packages-source"
						value={source}
						spellCheck={false}
						placeholder={t("packages.addPlaceholder")}
						onChange={(event) => setSource(event.target.value)}
						className="min-w-48 flex-1 font-mono"
					/>
					<Tabs value={scope} onValueChange={(value) => onScopeChange(value === "project" ? "project" : "user")}>
						<TabsList>
							{PACKAGE_SCOPES.map((group) => (
								<TabsTrigger
									key={group}
									value={group}
									data-testid={`packages-scope-${group}`}
									disabled={!cwd && group === "project"}
								>
									{SCOPE_LABEL[group]()}
								</TabsTrigger>
							))}
						</TabsList>
					</Tabs>
					<Button
						type="submit"
						data-testid="packages-install"
						disabled={busy !== undefined || source.trim().length === 0}
					>
						{busy === "install" ? <Spinner className="size-4" /> : <Download />}
						{t("packages.install")}
					</Button>
				</div>
				<p className="text-[11px] text-muted-foreground">{t("packages.addHint")}</p>
			</form>
			{error && (
				<p data-testid="packages-error" className="break-words text-destructive text-xs">
					{error}
				</p>
			)}
			<p className="text-[11px] text-muted-foreground">
				{busy !== undefined ? t("packages.working") : t("packages.applyNote")}
				{cwd ? ` ${t("packages.cwdNote", { cwd })}` : ""}
			</p>
		</div>
	);
}
