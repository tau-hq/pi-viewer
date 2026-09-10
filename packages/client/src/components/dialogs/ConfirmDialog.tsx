import { t } from "@/i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	description?: string;
	confirmLabel?: string;
	destructive?: boolean;
	onConfirm: () => void;
	onCancel: () => void;
}

export function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	destructive,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>
						{t("ui.cancel")}
					</Button>
					<Button variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
						{confirmLabel ?? t("ui.confirm")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
