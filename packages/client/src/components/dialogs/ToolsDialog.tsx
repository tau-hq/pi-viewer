import type { ToolInfo, ToolRequirement } from "@pi-tau/shared";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { pickArray } from "@/lib/result-data";
import { useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import { getTransport } from "@/transport/transport";
import { TransportError } from "@/transport/ws";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
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

/**
 * What the interface offers when a tool needs a program the machine does not have. The switch
 * stays where it is - a tool does not disappear because a binary is missing - and asks before
 * anything is installed.
 */
interface Prompt {
	requirement: ToolRequirement;
	state: "ask" | "installing" | "failed";
	message?: string;
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
	const [requirements, setRequirements] = useState<ToolRequirement[]>([]);
	const [prompt, setPrompt] = useState<Prompt | undefined>(undefined);
	const [failed, setFailed] = useState(false);
	const [busy, setBusy] = useState(false);

	const loadRequirements = () =>
		getTransport()
			.send({ type: "tools.requirements" })
			.then((data) => setRequirements(pickArray<ToolRequirement>(data, "requirements")))
			.catch(() => setRequirements([]));

	useEffect(() => {
		if (!open) return;
		setState(undefined);
		setFailed(false);
		setBusy(false);
		setPrompt(undefined);
		void loadRequirements();
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

	/** Put the tool's own switch where the user asked for it. */
	const setActive = async (name: string, enabled: boolean) => {
		if (!state) return;
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

	const toggle = async (name: string, enabled: boolean) => {
		if (!state || busy) return;
		const requirement = requirements.find((entry) => entry.tool === name);
		// Switching a tool off never needs anything, and neither does one whose program is there.
		if (!enabled || !requirement || requirement.available) {
			await setActive(name, enabled);
			return;
		}
		setPrompt({ requirement, state: "ask" });
	};

	/** Install what the tool needs, then switch it on; a failure says why and changes nothing. */
	const install = async () => {
		if (!prompt) return;
		const { tool } = prompt.requirement;
		setPrompt({ ...prompt, state: "installing" });
		try {
			const data = (await getTransport().send({ type: "tools.install", tool })) as {
				ok?: boolean;
				message?: string;
			};
			await loadRequirements();
			if (data.ok !== true) {
				setPrompt({ ...prompt, state: "failed", message: data.message ?? "" });
				return;
			}
			setPrompt(undefined);
			await setActive(tool, true);
		} catch (error) {
			setPrompt({ ...prompt, state: "failed", message: error instanceof Error ? error.message : String(error) });
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
						const requirement = requirements.find((entry) => entry.tool === tool.name);
						const missing = requirement !== undefined && !requirement.available;
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
									{missing && requirement && (
										<span data-testid={`tool-missing-${tool.name}`} className="mt-0.5 block text-warning text-xs">
											{t("tools.needs", { program: requirement.name })}
										</span>
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
			<RequirementPrompt prompt={prompt} onClose={() => setPrompt(undefined)} onInstall={() => void install()} />
		</Dialog>
	);
}

/**
 * Asks before installing, and explains when it cannot. Two ways out and no third: install it
 * now, or leave the tool as it was. Nothing is switched on that cannot work.
 */
function RequirementPrompt({
	prompt,
	onClose,
	onInstall,
}: {
	prompt: Prompt | undefined;
	onClose: () => void;
	onInstall: () => void;
}) {
	const requirement = prompt?.requirement;
	const canInstall = requirement?.install !== undefined;
	return (
		<Dialog open={prompt !== undefined} onOpenChange={(next) => !next && onClose()}>
			<DialogContent size="sm" data-testid="tool-requirement-dialog">
				<DialogHeader>
					<DialogTitle>
						{canInstall
							? t("tools.installTitle", { program: requirement?.name ?? "" })
							: t("tools.missingTitle", { program: requirement?.name ?? "" })}
					</DialogTitle>
					<DialogDescription>
						{prompt?.state === "failed"
							? t("tools.installFailed")
							: canInstall
								? t("tools.installBody", {
										tool: requirement?.tool ?? "",
										program: requirement?.name ?? "",
										manager: requirement?.install?.manager ?? "",
									})
								: (requirement?.reason ?? "")}
					</DialogDescription>
				</DialogHeader>
				{prompt?.state === "failed" && prompt.message && (
					<pre
						data-testid="tool-requirement-error"
						className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] text-muted-foreground"
					>
						{prompt.message}
					</pre>
				)}
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{canInstall && prompt?.state === "ask" ? t("ui.cancel") : t("ui.ok")}
					</Button>
					{canInstall && prompt?.state !== "failed" && (
						<Button
							data-testid="tool-requirement-install"
							disabled={prompt?.state === "installing"}
							onClick={onInstall}
						>
							{prompt?.state === "installing" && <Spinner className="size-3.5" />}
							{prompt?.state === "installing"
								? t("tools.installing", { program: requirement?.name ?? "" })
								: t("tools.installAction")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
