import type { CommandInfo } from "@pi-tau/shared";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { useCurrentSessionId, useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { Badge } from "../ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { type CommandSource, groupCommands } from "./commands";

const SOURCE_LABEL: Record<CommandSource, () => string> = {
	extension: () => t("commands.extension"),
	prompt: () => t("commands.prompt"),
	skill: () => t("commands.skill"),
	builtin: () => t("commands.builtin"),
};

/** Commands, prompts and skills of the shown session; picking one prefills the composer. */
export function CommandsDialog() {
	const open = useUiStore((s) => s.dialog === "commands");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const insertIntoComposer = useUiStore((s) => s.insertIntoComposer);
	const commandSilent = useSessionsStore((s) => s.commandSilent);
	const sessionId = useCurrentSessionId();
	const [commands, setCommands] = useState<CommandInfo[] | undefined>(undefined);

	useEffect(() => {
		if (!open) return;
		setCommands(undefined);
		let cancelled = false;
		commandSilent({ type: "getCommands" })
			.then((data) => {
				if (!cancelled) setCommands(pickArray<CommandInfo>(data, "commands"));
			})
			.catch(() => {
				if (!cancelled) setCommands([]);
			});
		return () => {
			cancelled = true;
		};
	}, [open, commandSilent]);

	const pick = (command: CommandInfo) => {
		if (sessionId) insertIntoComposer(sessionId, `/${command.name} `);
		closeDialog();
	};

	const groups = groupCommands(commands ?? []);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="commands-dialog" size="lg">
				<DialogHeader>
					<DialogTitle>{t("commands.title")}</DialogTitle>
					<DialogDescription>{t("commands.description")}</DialogDescription>
				</DialogHeader>
				<div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
					{commands === undefined && (
						<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
							<Spinner /> {t("commands.loading")}
						</div>
					)}
					{commands?.length === 0 && (
						<p className="p-6 text-center text-muted-foreground text-sm">{t("commands.empty")}</p>
					)}
					{groups.map((group) => (
						<section key={group.source}>
							<h3 className="border-border border-b bg-muted/40 px-3 py-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{SOURCE_LABEL[group.source]()}
							</h3>
							{group.commands.map((command) => (
								<button
									key={`${group.source}:${command.name}`}
									type="button"
									data-testid="command-item"
									onClick={() => pick(command)}
									className="flex w-full items-center gap-3 border-border border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
								>
									<span className="w-40 shrink-0 truncate font-mono text-[13px]">/{command.name}</span>
									<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
										{command.description ?? ""}
									</span>
									{command.scope && <Badge variant="outline">{command.scope}</Badge>}
								</button>
							))}
						</section>
					))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
