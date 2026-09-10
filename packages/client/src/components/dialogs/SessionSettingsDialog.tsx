import type { QueueMode } from "@pi-tau/shared";
import { t } from "@/i18n";
import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

const MODES: readonly QueueMode[] = ["all", "one-at-a-time"];

const MODE_TEXT = {
	all: { title: "sessionSettings.modeAll", hint: "sessionSettings.modeAllHint" },
	"one-at-a-time": { title: "sessionSettings.modeOne", hint: "sessionSettings.modeOneHint" },
} as const;

interface ModeRowProps {
	testId: string;
	label: string;
	hint: string;
	value: QueueMode;
	disabled: boolean;
	onChange: (mode: QueueMode) => void;
}

/** Segmented control for one of pi's two queue modes plus the sentence that explains it. */
function ModeRow({ testId, label, hint, value, disabled, onChange }: ModeRowProps) {
	return (
		<div className="flex flex-col gap-1.5" data-testid={testId}>
			<div className="flex items-center gap-3">
				<span className="min-w-0 flex-1 font-medium text-sm">{label}</span>
				<Tabs value={value} onValueChange={(next) => onChange(next as QueueMode)}>
					<TabsList>
						{MODES.map((mode) => (
							<TabsTrigger key={mode} value={mode} disabled={disabled} data-testid={`${testId}-${mode}`}>
								{t(MODE_TEXT[mode].title)}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>
			</div>
			<p className="text-muted-foreground text-xs">
				{hint} {t(MODE_TEXT[value].hint)}
			</p>
		</div>
	);
}

interface SwitchRowProps {
	testId: string;
	label: string;
	hint: string;
	note?: string;
	checked: boolean;
	disabled: boolean;
	onChange: (enabled: boolean) => void;
}

function SwitchRow({ testId, label, hint, note, checked, disabled, onChange }: SwitchRowProps) {
	return (
		<div className="flex flex-col gap-1.5" data-testid={testId}>
			<div className="flex items-center gap-3">
				<label htmlFor={testId} className="min-w-0 flex-1 cursor-pointer font-medium text-sm">
					{label}
				</label>
				<Switch id={testId} checked={checked} disabled={disabled} onCheckedChange={onChange} />
			</div>
			<p className="text-muted-foreground text-xs">{hint}</p>
			{note && <p className="text-[11px] text-muted-foreground/80">{note}</p>}
		</div>
	);
}

/**
 * The four session switches pi offers over RPC: queue handover for steering and follow-up
 * messages, automatic compaction and automatic retry.
 */
export function SessionSettingsDialog({ sessionId }: { sessionId: string }) {
	const open = useUiStore((s) => s.dialog === "sessionSettings");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const command = useSessionsStore((s) => s.command);
	const steeringMode = useSessionStore((s) => s.views[sessionId]?.state.steeringMode ?? "one-at-a-time");
	const followUpMode = useSessionStore((s) => s.views[sessionId]?.state.followUpMode ?? "one-at-a-time");
	const autoCompaction = useSessionStore((s) => s.views[sessionId]?.state.autoCompactionEnabled ?? true);
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	// pi never reports the retry switch, so Tau keeps its own value (default on).
	const autoRetry = useUiStore((s) => s.autoRetry[sessionId] ?? true);
	const setAutoRetry = useUiStore((s) => s.setAutoRetry);

	const run = (next: Parameters<typeof command>[0]) => void command(next).catch(() => undefined);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="session-settings-dialog">
				<DialogHeader>
					<DialogTitle>{t("sessionSettings.title")}</DialogTitle>
					<DialogDescription>{t("sessionSettings.description")}</DialogDescription>
				</DialogHeader>
				{!alive && <p className="text-warning text-xs">{t("sessionSettings.unavailable")}</p>}
				<p className="text-[11px] text-muted-foreground">{t("sessionSettings.persisted")}</p>
				<div className="flex flex-col gap-4">
					<ModeRow
						testId="setting-steering-mode"
						label={t("sessionSettings.steering")}
						hint={t("sessionSettings.steeringHint")}
						value={steeringMode}
						disabled={!alive}
						onChange={(mode) => run({ type: "setSteeringMode", mode })}
					/>
					<ModeRow
						testId="setting-followup-mode"
						label={t("sessionSettings.followUp")}
						hint={t("sessionSettings.followUpHint")}
						value={followUpMode}
						disabled={!alive}
						onChange={(mode) => run({ type: "setFollowUpMode", mode })}
					/>
					<SwitchRow
						testId="setting-auto-compaction"
						label={t("sessionSettings.autoCompaction")}
						hint={t("sessionSettings.autoCompactionHint")}
						checked={autoCompaction}
						disabled={!alive}
						onChange={(enabled) => run({ type: "setAutoCompaction", enabled })}
					/>
					<SwitchRow
						testId="setting-auto-retry"
						label={t("sessionSettings.autoRetry")}
						hint={t("sessionSettings.autoRetryHint")}
						note={t("sessionSettings.autoRetryLocal")}
						checked={autoRetry}
						disabled={!alive}
						onChange={(enabled) => {
							setAutoRetry(sessionId, enabled);
							void command({ type: "setAutoRetry", enabled }).catch(() => setAutoRetry(sessionId, !enabled));
						}}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
