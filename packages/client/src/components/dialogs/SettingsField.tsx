import type { ConfigScope } from "@pi-tau/shared";
import { Eraser, ListChecks, Plus, X } from "lucide-react";
import { useState } from "react";
import { t } from "@/i18n";
import { useUiStore } from "@/store/ui-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Input } from "../ui/input";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";
import { BUILTIN_TOOLS, type FieldSpec, fieldId } from "./settings-fields";
import {
	asBoolean,
	asNumber,
	asRows,
	asStringArray,
	asText,
	type MappingRow,
	rowsToRecord,
	toggleName,
} from "./settings-form";

export interface SettingsFieldProps {
	spec: FieldSpec;
	scope: ConfigScope;
	/** Value to show: the draft if edited, else this scope's, else the effective one. */
	shown: unknown;
	/** True when only the other scope sets the key. */
	inherited: boolean;
	/** True when this scope (or the draft) sets the key, so it can be removed again. */
	removable: boolean;
	onChange: (value: unknown) => void;
	disabled: boolean;
}

function ValueBadges({
	spec,
	shown,
	inherited,
	scope,
}: Pick<SettingsFieldProps, "spec" | "shown" | "inherited" | "scope">) {
	const unset = shown === undefined || shown === null;
	return (
		<>
			{inherited && (
				<Badge variant="secondary">
					{scope === "global" ? t("settingsForm.fromProject") : t("settingsForm.fromGlobal")}
				</Badge>
			)}
			{unset && spec.fallback === undefined && <Badge variant="outline">{t("settingsForm.notSet")}</Badge>}
		</>
	);
}

function EnumControl({ spec, shown, onChange, disabled }: SettingsFieldProps) {
	const value = asText(shown) ?? "";
	return (
		<Select
			id={fieldId(spec.path)}
			data-testid={fieldId(spec.path)}
			value={value}
			disabled={disabled}
			onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
		>
			<option value="">{spec.fallback === undefined ? t("settingsForm.notSet") : String(spec.fallback)}</option>
			{spec.options?.map((option) => (
				<option key={option} value={option}>
					{option}
				</option>
			))}
		</Select>
	);
}

function ToolsControl({ spec, shown, onChange, disabled }: SettingsFieldProps) {
	const selected = asStringArray(shown) ?? [];
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={fieldId(spec.path)}>
			{BUILTIN_TOOLS.map((tool) => {
				const id = `${fieldId(spec.path)}-${tool}`;
				return (
					<label key={tool} htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-xs">
						<input
							id={id}
							type="checkbox"
							className="size-3.5 accent-primary"
							checked={selected.includes(tool)}
							disabled={disabled}
							onChange={() => {
								const next = toggleName(selected, tool, BUILTIN_TOOLS);
								onChange(next.length === 0 ? null : next);
							}}
						/>
						<span className="font-mono">{tool}</span>
					</label>
				);
			})}
		</div>
	);
}

interface EditRow extends MappingRow {
	/** Local identity, so a row keeps its input while its key is still empty. */
	id: number;
}

let rowSeq = 0;

/**
 * `modelThinkingLevels`. The rows live locally: a row whose model is still empty is dropped
 * from the value pi gets, but must stay on screen while it is being typed.
 */
function RowsControl({ spec, shown, onChange, disabled }: SettingsFieldProps) {
	const [rows, setRows] = useState<EditRow[]>(() => asRows(shown).map((row) => ({ ...row, id: ++rowSeq })));
	const write = (next: EditRow[]) => {
		setRows(next);
		onChange(rowsToRecord(next));
	};
	const patch = (id: number, part: Partial<MappingRow>) =>
		write(rows.map((entry) => (entry.id === id ? { ...entry, ...part } : entry)));
	return (
		<div className="flex flex-col gap-1.5" data-testid={fieldId(spec.path)}>
			{rows.length === 0 && <p className="text-[11px] text-muted-foreground">{t("settingsForm.emptyRows")}</p>}
			{rows.map((row) => (
				<div key={row.id} className="flex items-center gap-1.5" data-testid={`${fieldId(spec.path)}-row`}>
					<Input
						aria-label={t("settingsForm.modelPlaceholder")}
						value={row.key}
						spellCheck={false}
						disabled={disabled}
						placeholder={t("settingsForm.modelPlaceholder")}
						className="flex-1 font-mono text-xs"
						onChange={(event) => patch(row.id, { key: event.target.value })}
					/>
					<Select
						aria-label={t(spec.label)}
						value={row.value}
						disabled={disabled}
						onChange={(event) => patch(row.id, { value: event.target.value })}
					>
						{spec.options?.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</Select>
					<IconButton
						size="iconSm"
						label={t("settingsForm.removeRow")}
						icon={<X />}
						disabled={disabled}
						onClick={() => write(rows.filter((entry) => entry.id !== row.id))}
					/>
				</div>
			))}
			<Button
				size="sm"
				variant="ghost"
				disabled={disabled}
				data-testid={`${fieldId(spec.path)}-add`}
				onClick={() => write([...rows, { id: ++rowSeq, key: "", value: spec.options?.[0] ?? "off" }])}
			>
				<Plus />
				{t("settingsForm.addRow")}
			</Button>
		</div>
	);
}

function LinkControl({ shown }: SettingsFieldProps) {
	const entries = asStringArray(shown) ?? [];
	return (
		<div className="flex items-center gap-2">
			{entries.length > 0 && <Badge variant="outline">{t("scopedModels.selected", { count: entries.length })}</Badge>}
			<Button
				size="sm"
				variant="outline"
				data-testid="settings-form-scoped-models"
				onClick={() => useUiStore.getState().openDialog("scopedModels")}
			>
				<ListChecks />
				{t("settingsForm.openScopedModels")}
			</Button>
		</div>
	);
}

function ScalarControl(props: SettingsFieldProps) {
	const { spec, shown, onChange, disabled } = props;
	const id = fieldId(spec.path);
	if (spec.kind === "boolean")
		return (
			<Switch
				id={id}
				data-testid={id}
				checked={asBoolean(shown) ?? asBoolean(spec.fallback) ?? false}
				disabled={disabled}
				onCheckedChange={(checked) => onChange(checked)}
			/>
		);
	if (spec.kind === "number")
		return (
			<Input
				id={id}
				data-testid={id}
				type="number"
				value={asNumber(shown) === undefined ? "" : String(asNumber(shown))}
				disabled={disabled}
				placeholder={spec.fallback === undefined ? "" : String(spec.fallback)}
				className="w-28"
				onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
			/>
		);
	if (spec.kind === "text")
		return (
			<Input
				id={id}
				data-testid={id}
				value={asText(shown) ?? ""}
				spellCheck={false}
				disabled={disabled}
				className="w-56 font-mono text-xs"
				onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
			/>
		);
	if (spec.kind === "enum") return <EnumControl {...props} />;
	return <LinkControl {...props} />;
}

/** One settings row: label, explanation, the control for its kind, and a way to unset it. */
export function SettingsField(props: SettingsFieldProps) {
	const { spec, shown, onChange, disabled, removable } = props;
	const id = fieldId(spec.path);
	const wide = spec.kind === "tools" || spec.kind === "rows";
	const clear = removable && spec.kind !== "link" && (
		<IconButton
			size="iconSm"
			label={t("settingsForm.clear")}
			icon={<Eraser />}
			data-testid={`${id}-clear`}
			disabled={disabled}
			onClick={() => onChange(null)}
		/>
	);
	return (
		<div data-testid={`${id}-row`} className="flex flex-col gap-1 border-border border-b px-3 py-2 last:border-b-0">
			<div className="flex items-center gap-3">
				<span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
					{/* Only the single-control kinds have one element to point a label at. */}
					{wide || spec.kind === "link" ? (
						<span className="font-medium text-sm">{t(spec.label)}</span>
					) : (
						<label htmlFor={id} className="font-medium text-sm">
							{t(spec.label)}
						</label>
					)}
					<span className="font-mono text-[10px] text-muted-foreground">{spec.path}</span>
					<ValueBadges {...props} />
				</span>
				<span className="flex shrink-0 items-center gap-1.5">
					{!wide && <ScalarControl {...props} />}
					{clear}
				</span>
			</div>
			{spec.kind === "tools" && <ToolsControl {...props} />}
			{spec.kind === "rows" && <RowsControl {...props} />}
			<p className="text-[11px] text-muted-foreground">
				{t(spec.hint)}
				{spec.kind === "tools" && (asStringArray(shown) ?? []).length === 0 ? ` ${t("settingsForm.noTools")}` : ""}
				{spec.globalOnly && disabled ? ` ${t("settingsForm.globalOnly")}` : ""}
			</p>
		</div>
	);
}
