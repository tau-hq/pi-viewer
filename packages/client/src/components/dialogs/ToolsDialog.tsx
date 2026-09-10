import type { ToolInfo } from "@pi-tau/shared";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { TransportError } from "@/transport/ws";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";

interface ToolsState {
	tools: ToolInfo[];
	active: string[];
}

function parseTools(data: unknown): ToolsState {
	const tools = pickArray<ToolInfo>(data, "tools").filter((tool) => typeof tool?.name === "string");
	const active = pickArray<unknown>(data, "active").filter((name): name is string => typeof name === "string");
	return { tools, active };
}

function report(command: string, error: unknown): void {
	if (error instanceof TransportError && error.code === "pi.extension") {
		toast("error", t("tools.extensionMissing"));
		return;
	}
	const message = error instanceof Error ? error.message : String(error);
	toast("error", t("toast.commandFailed", { command, message }));
}

/** Enable or disable pi's tools for the shown session (needs the Tau extension in pi). */
export function ToolsDialog() {
	const open = useUiStore((s) => s.dialog === "tools");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const commandSilent = useSessionsStore((s) => s.commandSilent);
	const [state, setState] = useState<ToolsState | undefined>(undefined);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		if (!open) return;
		setState(undefined);
		setFailed(false);
		setBusy(false);
		let cancelled = false;
		commandSilent({ type: "tools.list" })
			.then((data) => {
				if (!cancelled) setState(parseTools(data));
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setFailed(true);
				report("tools.list", error);
			});
		return () => {
			cancelled = true;
		};
	}, [open, commandSilent]);

	const toggle = async (name: string, enabled: boolean) => {
		if (!state || busy) return;
		const activeSet = new Set(state.active);
		const names = state.tools
			.filter((tool) => (tool.name === name ? enabled : activeSet.has(tool.name)))
			.map((tool) => tool.name);
		setBusy(true);
		try {
			setState(parseTools(await commandSilent({ type: "tools.set", names })));
		} catch (error) {
			report("tools.set", error);
		} finally {
			setBusy(false);
		}
	};

	const activeSet = new Set(state?.active ?? []);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="tools-dialog">
				<DialogHeader>
					<DialogTitle>{t("tools.title")}</DialogTitle>
					<DialogDescription>{t("tools.description")}</DialogDescription>
				</DialogHeader>
				{state && (
					<p className="text-muted-foreground text-xs">
						{t("tools.active", { active: state.active.length, total: state.tools.length })}
					</p>
				)}
				<div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
					{!state && !failed && (
						<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
							<Spinner /> {t("tools.loading")}
						</div>
					)}
					{failed && <p className="p-6 text-center text-muted-foreground text-sm">{t("tools.extensionMissing")}</p>}
					{state?.tools.length === 0 && (
						<p className="p-6 text-center text-muted-foreground text-sm">{t("tools.empty")}</p>
					)}
					{state?.tools.map((tool) => {
						const id = `tool-${tool.name}`;
						return (
							<div
								key={tool.name}
								className="flex items-center gap-3 border-border border-b px-3 py-2 text-sm last:border-b-0"
							>
								<label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
									<span className="block font-mono text-[13px]">{tool.name}</span>
									{tool.description && (
										<span className="line-clamp-2 block text-muted-foreground text-xs">{tool.description}</span>
									)}
								</label>
								<Switch
									id={id}
									checked={activeSet.has(tool.name)}
									disabled={busy}
									onCheckedChange={(checked) => void toggle(tool.name, checked)}
								/>
							</div>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
