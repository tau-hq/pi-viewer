import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

interface PromptDialogProps {
	open: boolean;
	title: string;
	description?: string;
	initialValue?: string;
	placeholder?: string;
	submitLabel?: string;
	onSubmit: (value: string) => void;
	onCancel: () => void;
}

export function PromptDialog({
	open,
	title,
	description,
	initialValue = "",
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
}: PromptDialogProps) {
	const [value, setValue] = useState(initialValue);
	useEffect(() => {
		if (open) setValue(initialValue);
	}, [open, initialValue]);

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const trimmed = value.trim();
		if (trimmed) onSubmit(trimmed);
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
			<DialogContent size="sm">
				<form onSubmit={submit} className="flex flex-col gap-4">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						{description && <DialogDescription>{description}</DialogDescription>}
					</DialogHeader>
					<Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={onCancel}>
							{t("ui.cancel")}
						</Button>
						<Button type="submit" disabled={!value.trim()}>
							{submitLabel ?? t("ui.ok")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
