import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { thinkingLabel } from "../composer/ThinkingPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { type AdvancedOptionsState, countAdvancedOptions, removeAt, replaceAt } from "./session-options";
import { builtinToolsFor, THINKING_LEVEL_VALUES } from "./settings-fields";
import { toggleName } from "./settings-form";

interface AdvancedSessionOptionsProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	value: AdvancedOptionsState;
	onChange: (value: AdvancedOptionsState) => void;
}

function SwitchRow({
	id,
	label,
	hint,
	checked,
	onChange,
}: {
	id: string;
	label: string;
	hint: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-3">
				<label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-medium text-sm">
					{label}
				</label>
				<Switch id={id} data-testid={id} checked={checked} onCheckedChange={onChange} />
			</div>
			<p className="text-[11px] text-muted-foreground">{hint}</p>
		</div>
	);
}

function ToolChecklist({
	testId,
	selected,
	disabled,
	onToggle,
}: {
	testId: string;
	selected: string[];
	disabled: boolean;
	onToggle: (names: string[]) => void;
}) {
	const tools = builtinToolsFor(useConnectionStore((s) => s.host?.platform));
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={testId}>
			{tools.map((tool) => {
				const id = `${testId}-${tool}`;
				return (
					<label key={tool} htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-xs">
						<input
							id={id}
							type="checkbox"
							className="size-3.5 accent-primary"
							checked={selected.includes(tool)}
							disabled={disabled}
							onChange={() => onToggle(toggleName(selected, tool, tools))}
						/>
						<span className="font-mono">{tool}</span>
					</label>
				);
			})}
		</div>
	);
}

/** pi's startup flags for a new session, collapsed away until someone needs them. */
export function AdvancedSessionOptions({ open, onOpenChange, value, onChange }: AdvancedSessionOptionsProps) {
	const set = (patch: Partial<AdvancedOptionsState>) => onChange({ ...value, ...patch });
	const count = countAdvancedOptions(value);

	return (
		<section className="rounded-md border border-border">
			<button
				type="button"
				data-testid="session-advanced-toggle"
				aria-expanded={open}
				onClick={() => onOpenChange(!open)}
				className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/50"
			>
				{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
				<span className="flex-1 font-medium">{t("advancedSession.toggle")}</span>
				{count > 0 && <Badge variant="default">{count}</Badge>}
			</button>
			{open && (
				<div data-testid="session-advanced" className="flex flex-col gap-3 border-border border-t p-3">
					<p className="text-[11px] text-muted-foreground">{t("advancedSession.hint")}</p>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="session-system-prompt" className="text-muted-foreground text-xs">
							{t("advancedSession.systemPrompt")}
						</label>
						<Textarea
							id="session-system-prompt"
							data-testid="session-system-prompt"
							value={value.systemPrompt}
							spellCheck={false}
							className="min-h-14 text-xs"
							onChange={(event) => set({ systemPrompt: event.target.value })}
						/>
						<p className="text-[11px] text-muted-foreground">{t("advancedSession.systemPromptHint")}</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<label htmlFor="session-append-system-prompt" className="text-muted-foreground text-xs">
							{t("advancedSession.appendSystemPrompt")}
						</label>
						<Textarea
							id="session-append-system-prompt"
							data-testid="session-append-system-prompt"
							value={value.appendSystemPrompt}
							spellCheck={false}
							className="min-h-14 text-xs"
							onChange={(event) => set({ appendSystemPrompt: event.target.value })}
						/>
						<p className="text-[11px] text-muted-foreground">{t("advancedSession.appendSystemPromptHint")}</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<SwitchRow
							id="session-restrict-tools"
							label={t("advancedSession.restrictTools")}
							hint={t("advancedSession.restrictToolsHint")}
							checked={value.restrictTools}
							onChange={(checked) => set({ restrictTools: checked })}
						/>
						<ToolChecklist
							testId="session-tools"
							selected={value.tools}
							disabled={!value.restrictTools}
							onToggle={(tools) => set({ tools })}
						/>
						{value.restrictTools && value.tools.length === 0 && (
							<p data-testid="session-no-tools" className="text-[11px] text-warning">
								{t("advancedSession.noTools")}
							</p>
						)}
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">{t("advancedSession.excludeTools")}</span>
						<ToolChecklist
							testId="session-exclude-tools"
							selected={value.excludeTools}
							disabled={false}
							onToggle={(excludeTools) => set({ excludeTools })}
						/>
						<p className="text-[11px] text-muted-foreground">{t("advancedSession.excludeToolsHint")}</p>
					</div>
					<div className="flex flex-col gap-1.5">
						<span className="text-muted-foreground text-xs">{t("advancedSession.extensions")}</span>
						{value.extensions.map((entry, index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the row list only grows and shrinks at the end, and the value is the only state
							<div key={`extension-${index}`} className="flex items-center gap-1.5">
								<Input
									data-testid="session-extension"
									aria-label={t("advancedSession.extensions")}
									value={entry}
									spellCheck={false}
									className="font-mono text-xs"
									onChange={(event) => set({ extensions: replaceAt(value.extensions, index, event.target.value) })}
								/>
								<IconButton
									size="iconSm"
									label={t("advancedSession.removeExtension")}
									icon={<X />}
									onClick={() => set({ extensions: removeAt(value.extensions, index) })}
								/>
							</div>
						))}
						<Button
							size="sm"
							variant="ghost"
							data-testid="session-add-extension"
							className="self-start"
							onClick={() => set({ extensions: [...value.extensions, ""] })}
						>
							<Plus />
							{t("advancedSession.addExtension")}
						</Button>
						<p className="text-[11px] text-muted-foreground">{t("advancedSession.extensionsHint")}</p>
					</div>
					<SwitchRow
						id="session-no-context-files"
						label={t("advancedSession.noContextFiles")}
						hint={t("advancedSession.noContextFilesHint")}
						checked={value.noContextFiles}
						onChange={(checked) => set({ noContextFiles: checked })}
					/>
					<SwitchRow
						id="session-ephemeral"
						label={t("advancedSession.ephemeral")}
						hint={t("advancedSession.ephemeralHint")}
						checked={value.ephemeral}
						onChange={(checked) => set({ ephemeral: checked })}
					/>
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-3">
							<label htmlFor="session-thinking-level" className="min-w-0 flex-1 font-medium text-sm">
								{t("advancedSession.thinkingLevel")}
							</label>
							<Select
								id="session-thinking-level"
								data-testid="session-thinking-level"
								value={value.thinkingLevel}
								onChange={(event) =>
									set({ thinkingLevel: THINKING_LEVEL_VALUES.find((level) => level === event.target.value) ?? "" })
								}
							>
								<option value="">{t("advancedSession.defaultOption")}</option>
								{THINKING_LEVEL_VALUES.map((level) => (
									<option key={level} value={level}>
										{thinkingLabel(level)}
									</option>
								))}
							</Select>
						</div>
						<p className="text-[11px] text-muted-foreground">{t("advancedSession.thinkingLevelHint")}</p>
					</div>
				</div>
			)}
		</section>
	);
}
