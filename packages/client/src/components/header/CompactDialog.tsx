import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Textarea } from "../ui/textarea";

export function CompactDialog() {
	const open = useUiStore((s) => s.dialog === "compact");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const command = useSessionsStore((s) => s.command);
	const [instructions, setInstructions] = useState("");
	useEffect(() => {
		if (open) setInstructions("");
	}, [open]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const custom = instructions.trim();
		// Compaction can take minutes; progress arrives as compaction.start/end events.
		void command({ type: "compact", ...(custom ? { customInstructions: custom } : {}) }).catch(() => undefined);
		closeDialog();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent>
				<form onSubmit={submit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>{t("compact.title")}</DialogTitle>
						<DialogDescription>{t("compact.description")}</DialogDescription>
					</DialogHeader>
					<Textarea
						value={instructions}
						onChange={(e) => setInstructions(e.target.value)}
						placeholder={t("compact.placeholder")}
						className="min-h-24"
					/>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={closeDialog}>
							{t("ui.cancel")}
						</Button>
						<Button type="submit">{t("compact.submit")}</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
