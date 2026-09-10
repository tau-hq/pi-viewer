import type { ApprovalMode } from "@pi-tau/shared";
import { ChevronDown, Shield, ShieldCheck, ShieldHalf, ShieldOff } from "lucide-react";
import { type ComponentType, type KeyboardEvent, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { toast } from "@/store/ui-store";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Kbd } from "../ui/kbd";
import { APPROVAL_MODE_TEXT, APPROVAL_MODES, approvalModeForKey, nextApprovalMode } from "./approval-modes";

/** Growing amount of protection, so the icon alone says how guarded the session is. */
const ICONS: Record<ApprovalMode, ComponentType<{ className?: string }>> = {
	auto: ShieldOff,
	acceptEdits: ShieldHalf,
	manual: Shield,
	strict: ShieldCheck,
};

/** An unattended session is worth a warning colour wherever the mode is shown. */
export function approvalModeClass(mode: ApprovalMode): string | undefined {
	return mode === "auto" ? "text-warning" : undefined;
}

/**
 * Switch the mode optimistically: the host patches its own state and answers with a
 * `state.update`, so only a failure has to be undone locally.
 */
export function applyApprovalMode(sessionId: string, mode: ApprovalMode): void {
	const previous = useSessionStore.getState().views[sessionId]?.state.approvalMode;
	// Undefined means the session has no Tau extension, so there is no mode to set.
	if (previous === undefined || previous === mode) return;
	const patch = (next: ApprovalMode) => {
		const current = useSessionStore.getState().views[sessionId];
		if (!current) return;
		useSessionStore
			.getState()
			.applyEvent(sessionId, current.lastSeq, { type: "state.update", state: { approvalMode: next } });
	};
	patch(mode);
	void useSessionsStore
		.getState()
		.commandSilent({ type: "setApprovalMode", mode })
		.catch((error: unknown) => {
			patch(previous);
			toast("error", t("mode.failed", { message: error instanceof Error ? error.message : String(error) }));
		});
}

/** Shift+Tab: step to the next mode of the shown session. */
export function cycleApprovalMode(): void {
	const sessionId = useSessionsStore.getState().currentSessionId;
	if (!sessionId) return;
	const view = useSessionStore.getState().views[sessionId];
	// Without Tau's pi extension there is no mode to cycle.
	if (!view?.state.approvalMode || !view.state.processAlive) return;
	applyApprovalMode(sessionId, nextApprovalMode(view.state.approvalMode));
}

/** How much the agent may do without asking; hidden when the session has no Tau extension. */
export function ModeMenu({ sessionId }: { sessionId: string }) {
	const mode = useSessionStore((s) => s.views[sessionId]?.state.approvalMode);
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	const [open, setOpen] = useState(false);

	if (!mode) return null;
	const Icon = ICONS[mode];
	const warn = approvalModeClass(mode);

	// Number keys pick an entry while the menu is open, like the shortcuts in the approval dialog.
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const picked = approvalModeForKey(event.key);
		if (!picked) return;
		event.preventDefault();
		setOpen(false);
		applyApprovalMode(sessionId, picked);
	};

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					disabled={!alive}
					data-testid="mode-trigger"
					className={cn("gap-1.5 font-normal", warn)}
					title={`${t("mode.title")} · ${t("mode.cycle")}`}
				>
					<Icon className={warn ?? "text-muted-foreground"} />
					{t(APPROVAL_MODE_TEXT[mode].title)}
					<ChevronDown className="size-3.5 text-muted-foreground" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" data-testid="mode-menu" className="min-w-72" onKeyDown={onKeyDown}>
				{APPROVAL_MODES.map((item, index) => (
					<DropdownMenuItem
						key={item}
						checked={item === mode}
						data-testid={`mode-option-${item}`}
						className="items-start py-1.5"
						onSelect={() => applyApprovalMode(sessionId, item)}
					>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className={cn("flex items-center gap-2", approvalModeClass(item))}>
								{t(APPROVAL_MODE_TEXT[item].title)}
								<Kbd>{index + 1}</Kbd>
							</span>
							<span className="text-muted-foreground text-xs">{t(APPROVAL_MODE_TEXT[item].description)}</span>
						</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
