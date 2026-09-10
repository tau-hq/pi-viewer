import { Keyboard } from "lucide-react";
import { SHORTCUT_GROUP_LABEL, SHORTCUT_GROUPS, shortcutsOf } from "@/app/shortcuts";
import { t } from "@/i18n";
import { useUiStore } from "@/store/ui-store";
import { SessionStatusDot } from "../sidebar/SessionStatusDot";
import { SESSION_STATUS_LABEL, SESSION_STATUSES } from "../sidebar/session-status";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Kbd } from "../ui/kbd";

/**
 * What the five circles in the session list mean. It lives with the shortcuts because this is
 * the one place the app explains itself; the row keeps just the circle.
 */
function StatusLegend() {
	return (
		<section data-testid="status-legend" className="flex flex-col gap-1.5 border-border/60 border-t pt-3">
			<div className="flex items-baseline gap-2">
				<h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
					{t("sessionStatus.legend")}
				</h3>
				<span className="text-[11px] text-muted-foreground/70">{t("sessionStatus.legendHint")}</span>
			</div>
			<ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
				{SESSION_STATUSES.map((status) => (
					<li key={status} data-testid="legend-row" className="flex items-center gap-2 text-muted-foreground text-xs">
						<SessionStatusDot status={status} decorative />
						{t(SESSION_STATUS_LABEL[status])}
					</li>
				))}
			</ul>
		</section>
	);
}

/** Overview of Tau's keyboard shortcuts, rendered from the same table the handlers use. */
export function HotkeysDialog() {
	const open = useUiStore((s) => s.dialog === "hotkeys");
	const closeDialog = useUiStore((s) => s.closeDialog);
	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="hotkeys-dialog" size="lg">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<Keyboard className="size-4 text-muted-foreground" />
						<DialogTitle>{t("hotkeys.title")}</DialogTitle>
					</div>
					<DialogDescription>{t("hotkeys.description")}</DialogDescription>
				</DialogHeader>
				<div className="grid max-h-[60vh] gap-4 overflow-y-auto sm:grid-cols-2">
					{SHORTCUT_GROUPS.map((group) => (
						<section key={group} data-testid={`hotkeys-group-${group}`} className="flex flex-col gap-1">
							<h3 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
								{t(SHORTCUT_GROUP_LABEL[group])}
							</h3>
							<ul className="flex flex-col">
								{shortcutsOf(group).map((shortcut) => (
									<li
										key={shortcut.id}
										data-testid="hotkey-row"
										className="flex items-baseline gap-2 border-border/60 border-b py-1.5 text-sm last:border-b-0"
									>
										<Kbd className="h-auto shrink-0 py-0.5">{shortcut.keys}</Kbd>
										<span className="min-w-0 flex-1 text-muted-foreground text-xs">{t(shortcut.description)}</span>
									</li>
								))}
							</ul>
						</section>
					))}
				</div>
				<StatusLegend />
				<p className="text-[11px] text-muted-foreground">{t("hotkeys.hint")}</p>
			</DialogContent>
		</Dialog>
	);
}
