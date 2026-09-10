import type { ModelInfo } from "@pi-tau/shared";
import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { separatorFor } from "@/lib/paths";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { ModelMenu } from "../header/ModelMenu";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { AdvancedSessionOptions } from "./AdvancedSessionOptions";
import { DirectoryPicker } from "./DirectoryPicker";
import { type AdvancedOptionsState, buildSessionOptions, EMPTY_ADVANCED_OPTIONS } from "./session-options";

export function NewSessionDialog() {
	const open = useUiStore((s) => s.dialog === "newSession");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd ?? "");
	const platform = useConnectionStore((s) => s.host?.platform);
	const models = useSessionsStore((s) => s.models);
	const create = useSessionsStore((s) => s.create);
	const [cwd, setCwd] = useState(defaultCwd);
	const [model, setModel] = useState<ModelInfo | undefined>(undefined);
	const [busy, setBusy] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [advanced, setAdvanced] = useState<AdvancedOptionsState>(EMPTY_ADVANCED_OPTIONS);

	useEffect(() => {
		if (open) {
			setCwd(defaultCwd);
			setModel(undefined);
			setBusy(false);
			setAdvancedOpen(false);
			setAdvanced(EMPTY_ADVANCED_OPTIONS);
		}
	}, [open, defaultCwd]);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const dir = cwd.trim();
		if (!dir || busy) return;
		setBusy(true);
		try {
			await create(dir, model ? { provider: model.provider, id: model.id } : undefined, buildSessionOptions(advanced));
			closeDialog();
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "sessions.create", message: String(error) }));
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent>
				<form onSubmit={submit} className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto">
					<DialogHeader>
						<DialogTitle>{t("newSession.title")}</DialogTitle>
						<DialogDescription>{t("newSession.description")}</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-1.5 text-sm">
						<label htmlFor="new-session-cwd" className="text-muted-foreground text-xs">
							{t("newSession.cwd")}
						</label>
						<Input
							id="new-session-cwd"
							value={cwd}
							onChange={(e) => setCwd(e.target.value)}
							spellCheck={false}
							className="font-mono"
						/>
						{open && <DirectoryPicker value={cwd} onChange={setCwd} separator={separatorFor(platform)} />}
					</div>
					<div className="flex flex-col gap-1.5 text-sm">
						<span className="text-muted-foreground text-xs">{t("newSession.model")}</span>
						<ModelMenu
							models={models}
							current={model}
							placeholder={t("newSession.defaultModel")}
							onSelect={setModel}
							allowClear
						/>
					</div>
					<AdvancedSessionOptions
						open={advancedOpen}
						onOpenChange={setAdvancedOpen}
						value={advanced}
						onChange={setAdvanced}
					/>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={closeDialog}>
							{t("ui.cancel")}
						</Button>
						<Button type="submit" disabled={!cwd.trim() || busy}>
							{busy ? t("newSession.creating") : t("newSession.create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
