import type { ConfigScope } from "@pi-tau/shared";
import { RotateCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickString } from "@/lib/result-data";
import { toast } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SettingsField } from "./SettingsField";
import { type FieldSpec, SETTINGS_GROUPS } from "./settings-fields";
import { buildPatch, type JsonRecord, parseSettings, scopedValue } from "./settings-form";
import { errorMessage } from "./use-project-cwd";

interface Loaded {
	global: JsonRecord;
	project: JsonRecord;
	/** Path of the file the selected scope writes to. */
	path: string;
	/** Bumped on every read and write, so controls with local state reseed. */
	generation: number;
}

interface SettingsFormProps {
	scope: ConfigScope;
	projectCwd: string | undefined;
}

async function readScope(scope: ConfigScope, cwd: string | undefined): Promise<{ settings: JsonRecord; path: string }> {
	const data = await getTransport().send({ type: "config.read", file: "settings", scope, ...(cwd ? { cwd } : {}) });
	return { settings: parseSettings(pickString(data, "content") ?? ""), path: pickString(data, "path") ?? "" };
}

/**
 * Typed controls for the settings that matter in a browser. Values are shown as pi resolves
 * them (global merged with the project), edits are written to the selected scope through
 * `settings.patch`, so every other key of the file survives.
 */
export function SettingsForm({ scope, projectCwd }: SettingsFormProps) {
	const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);
	const [draft, setDraft] = useState<Record<string, unknown>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const load = useCallback(async () => {
		setBusy(true);
		setError(undefined);
		try {
			const global = await readScope("global", undefined);
			const project = projectCwd ? await readScope("project", projectCwd) : { settings: {}, path: "" };
			setLoaded((current) => ({
				global: global.settings,
				project: project.settings,
				path: scope === "project" ? project.path : global.path,
				generation: (current?.generation ?? 0) + 1,
			}));
			setDraft({});
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setBusy(false);
		}
	}, [projectCwd, scope]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = async () => {
		if (!loaded || Object.keys(draft).length === 0) return;
		setBusy(true);
		setError(undefined);
		try {
			const data = await getTransport().send({
				type: "settings.patch",
				scope,
				...(scope === "project" && projectCwd ? { cwd: projectCwd } : {}),
				patch: buildPatch(draft),
			});
			const written = parseSettings(pickString(data, "content") ?? "");
			setLoaded({
				global: scope === "global" ? written : loaded.global,
				project: scope === "project" ? written : loaded.project,
				path: pickString(data, "path") ?? loaded.path,
				generation: loaded.generation + 1,
			});
			setDraft({});
			toast("info", t("config.saved", { path: pickString(data, "path") ?? loaded.path }));
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setBusy(false);
		}
	};

	const dirtyCount = Object.keys(draft).length;

	const row = (spec: FieldSpec) => {
		const value = loaded
			? scopedValue(loaded.global, loaded.project, scope, spec.path)
			: { effective: undefined, own: undefined, inherited: false };
		const edited = spec.path in draft;
		const shown = edited ? draft[spec.path] : (value.own ?? value.effective);
		return (
			<SettingsField
				key={`${spec.path}:${loaded?.generation ?? 0}`}
				spec={spec}
				scope={scope}
				shown={shown}
				inherited={!edited && value.inherited}
				removable={shown !== undefined && shown !== null}
				disabled={loaded === undefined || busy || (spec.globalOnly === true && scope === "project")}
				onChange={(next) => setDraft((current) => ({ ...current, [spec.path]: next }))}
			/>
		);
	};

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center gap-2">
				<code data-testid="config-path" className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
					{loaded?.path}
				</code>
				{dirtyCount > 0 && <Badge variant="warning">{t("settingsForm.dirty", { count: dirtyCount })}</Badge>}
				{busy && <Spinner className="size-3.5" />}
			</div>
			<div data-testid="settings-form" className="max-h-[38vh] overflow-y-auto rounded-md border border-border">
				{loaded === undefined ? (
					<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
						<Spinner /> {t("settingsForm.loading")}
					</div>
				) : (
					SETTINGS_GROUPS.map((group) => (
						<section key={group.id} data-testid={`settings-group-${group.id}`}>
							<h3 className="border-border border-b bg-muted/40 px-3 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{t(group.title)}
							</h3>
							{group.fields.map((spec) => row(spec))}
						</section>
					))
				)}
			</div>
			{error && (
				<p data-testid="settings-form-error" className="break-words text-destructive text-xs">
					{error}
				</p>
			)}
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t("settingsForm.effectiveNote")}</p>
				<Button variant="ghost" disabled={busy} onClick={() => void load()}>
					<RotateCw />
					{t("config.reload")}
				</Button>
				<Button data-testid="settings-form-save" disabled={busy || dirtyCount === 0} onClick={() => void save()}>
					<Save />
					{busy ? t("settingsForm.saving") : t("settingsForm.save")}
				</Button>
			</div>
		</div>
	);
}
