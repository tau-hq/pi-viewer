import type { ConfigDocument, ConfigFile, ConfigScope } from "@pi-tau/shared";
import { RotateCw, Save, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { t } from "@/i18n";
import { isBlank, jsonSyntaxError } from "@/lib/json";
import { asRecord } from "@/lib/result-data";
import { toast } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import { errorMessage } from "./use-project-cwd";

const FILES: readonly ConfigFile[] = ["settings", "models", "keybindings"];
const FILE_LABEL: Record<ConfigFile, () => string> = {
	settings: () => t("config.settings"),
	models: () => t("config.models"),
	keybindings: () => t("config.keybindings"),
};

function toDocument(data: unknown, file: ConfigFile, scope: ConfigScope): ConfigDocument {
	const record = asRecord(data) ?? {};
	return {
		file,
		scope,
		path: typeof record.path === "string" ? record.path : "",
		content: typeof record.content === "string" ? record.content : "",
		exists: record.exists === true,
	};
}

interface ConfigEditorProps {
	scope: ConfigScope;
	projectCwd: string | undefined;
}

/** Raw JSON editor for pi's three configuration files; the escape hatch behind the form. */
export function ConfigEditor({ scope, projectCwd }: ConfigEditorProps) {
	const [file, setFile] = useState<ConfigFile>("settings");
	const [doc, setDoc] = useState<ConfigDocument | undefined>(undefined);
	const [text, setText] = useState("");
	const [error, setError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		setBusy(true);
		setError(undefined);
		setDoc(undefined);
		try {
			const cwd = scope === "project" ? projectCwd : undefined;
			const data = await getTransport().send({ type: "config.read", file, scope, ...(cwd ? { cwd } : {}) });
			const next = toDocument(data, file, scope);
			setDoc(next);
			setText(next.content);
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setBusy(false);
		}
	}, [file, scope, projectCwd]);

	useEffect(() => {
		void load();
	}, [load]);

	const save = async () => {
		if (isBlank(text)) {
			setError(t("config.emptyContent"));
			return;
		}
		const syntax = jsonSyntaxError(text);
		if (syntax) {
			setError(t("config.invalidJson", { message: syntax }));
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			const cwd = scope === "project" ? projectCwd : undefined;
			const data = await getTransport().send({
				type: "config.write",
				file,
				scope,
				content: text,
				...(cwd ? { cwd } : {}),
			});
			const next = toDocument(data, file, scope);
			setDoc(next);
			toast("info", t("config.saved", { path: next.path }));
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setBusy(false);
		}
	};

	const dirty = doc !== undefined && text !== doc.content;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-2">
				<Tabs value={file} onValueChange={(value) => setFile(value as ConfigFile)}>
					<TabsList>
						{FILES.map((name) => (
							<TabsTrigger key={name} value={name}>
								{FILE_LABEL[name]()}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
				<div className="flex-1" />
				{doc && !doc.exists && <Badge variant="outline">{t("config.missing")}</Badge>}
				{busy && <Spinner />}
			</div>
			{doc && (
				<code data-testid="config-path" className="block truncate font-mono text-[11px] text-muted-foreground">
					{doc.path}
				</code>
			)}
			{file === "models" && (
				<p
					data-testid="config-credentials-warning"
					className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-warning text-xs"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0" />
					{t("config.credentials")}
				</p>
			)}
			<Textarea
				data-testid="config-editor"
				aria-label={FILE_LABEL[file]()}
				value={text}
				spellCheck={false}
				disabled={doc === undefined}
				placeholder={t("config.placeholder")}
				onChange={(e) => setText(e.target.value)}
				className="h-[40vh] resize-none font-mono text-xs leading-relaxed"
			/>
			{error && (
				<p data-testid="config-error" className="break-words text-destructive text-xs">
					{error}
				</p>
			)}
			<div className="flex items-center gap-2">
				<p className="min-w-0 flex-1 text-[11px] text-muted-foreground">{t("config.applyNote")}</p>
				<Button variant="ghost" disabled={busy} onClick={() => void load()}>
					<RotateCw />
					{t("config.reload")}
				</Button>
				<Button disabled={busy || !dirty} onClick={() => void save()}>
					<Save />
					{busy ? t("config.saving") : t("config.save")}
				</Button>
			</div>
		</div>
	);
}
