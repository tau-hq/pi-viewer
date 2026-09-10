import { FileUp } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

/** The host refuses anything that is not a pi session file, so a cheap shape check is enough here. */
function looksLikeSessionFile(path: string): boolean {
	return /^([a-zA-Z]:[\\/]|[\\/~]).*\.jsonl$/.test(path.trim());
}

/** Import a JSONL session file: the host copies it into pi's session directory and opens it. */
export function ImportSessionDialog() {
	const open = useUiStore((s) => s.dialog === "importSession");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const importSession = useSessionsStore((s) => s.importSession);
	const [path, setPath] = useState("");
	const [cwd, setCwd] = useState("");
	const [error, setError] = useState<string | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setPath("");
		setCwd("");
		setError(undefined);
		setBusy(false);
	}, [open]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const sourcePath = path.trim();
		if (busy) return;
		if (!looksLikeSessionFile(sourcePath)) {
			setError(t("importSession.needsPath"));
			return;
		}
		setBusy(true);
		setError(undefined);
		try {
			const imported = await importSession(sourcePath, cwd.trim() || undefined);
			toast("info", t("importSession.imported", { path: imported.path }));
			closeDialog();
		} catch (importError) {
			setError(importError instanceof Error ? importError.message : String(importError));
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="import-session-dialog">
				<form onSubmit={submit} className="flex flex-col gap-4">
					<DialogHeader>
						<div className="flex items-center gap-2">
							<FileUp className="size-4 text-muted-foreground" />
							<DialogTitle>{t("importSession.title")}</DialogTitle>
						</div>
						<DialogDescription>{t("importSession.description")}</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-1.5 text-sm">
						<label htmlFor="import-session-path" className="text-muted-foreground text-xs">
							{t("importSession.path")}
						</label>
						<Input
							id="import-session-path"
							data-testid="import-session-path"
							value={path}
							spellCheck={false}
							autoFocus
							placeholder={t("importSession.placeholder")}
							onChange={(e) => setPath(e.target.value)}
							className="font-mono"
						/>
					</div>
					<div className="flex flex-col gap-1.5 text-sm">
						<label htmlFor="import-session-cwd" className="text-muted-foreground text-xs">
							{t("importSession.cwd")}
						</label>
						<Input
							id="import-session-cwd"
							value={cwd}
							spellCheck={false}
							onChange={(e) => setCwd(e.target.value)}
							className="font-mono"
						/>
						<p className="text-[11px] text-muted-foreground">{t("importSession.cwdHint")}</p>
					</div>
					{error && (
						<p data-testid="import-session-error" className="break-words text-destructive text-xs">
							{error}
						</p>
					)}
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={closeDialog}>
							{t("ui.cancel")}
						</Button>
						<Button type="submit" disabled={busy || path.trim().length === 0}>
							{busy ? t("importSession.importing") : t("importSession.submit")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
