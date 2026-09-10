import type { UiRequest } from "@pi-tau/shared";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ShieldCheck } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { useSessionsStore } from "@/store/sessions-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { approvalShortcuts, parseApproval, splitTitle } from "./approval";
import { type Answer, UiSelectBody } from "./UiSelectBody";

// The dialog is keyed by request id, so a new request always mounts a fresh countdown.
function useCountdown(timeoutMs: number | undefined): number | undefined {
	const [remaining, setRemaining] = useState<number | undefined>(undefined);
	useEffect(() => {
		if (timeoutMs === undefined) {
			setRemaining(undefined);
			return;
		}
		const deadline = Date.now() + timeoutMs;
		const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
		tick();
		const timer = setInterval(tick, 500);
		return () => clearInterval(timer);
	}, [timeoutMs]);
	return remaining;
}

function InputBody({ request, answer }: { request: Extract<UiRequest, { method: "input" }>; answer: Answer }) {
	const [value, setValue] = useState("");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		answer({ id: request.id, value });
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<Input
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder={request.placeholder ?? t("ui.inputPlaceholder")}
			/>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => answer({ id: request.id, cancelled: true })}>
					{t("ui.cancel")}
				</Button>
				<Button type="submit">{t("ui.submit")}</Button>
			</DialogFooter>
		</form>
	);
}

function EditorBody({ request, answer }: { request: Extract<UiRequest, { method: "editor" }>; answer: Answer }) {
	const [value, setValue] = useState(request.prefill ?? "");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		answer({ id: request.id, value });
	};
	return (
		<form onSubmit={submit} className="flex flex-col gap-3">
			<Textarea
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder={t("ui.editorPlaceholder")}
				className="min-h-48 font-mono text-xs"
			/>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={() => answer({ id: request.id, cancelled: true })}>
					{t("ui.cancel")}
				</Button>
				<Button type="submit">{t("ui.submit")}</Button>
			</DialogFooter>
		</form>
	);
}

/**
 * Modal for the oldest pending extension UI request (select, confirm, input, editor).
 * Closing it (Esc, backdrop, X) answers `cancelled` so pi never waits forever.
 */
export function UiRequestDialog({ request }: { request: UiRequest }) {
	const command = useSessionsStore((s) => s.command);
	const remaining = useCountdown("timeoutMs" in request ? request.timeoutMs : undefined);
	const [answered, setAnswered] = useState(false);
	const { heading, detail } = splitTitle(request.title);
	const approval = parseApproval(heading);
	const shortcuts = approval && request.method === "select" ? approvalShortcuts(request.options) : undefined;

	const answer: Answer = (response) => {
		if (answered) return;
		setAnswered(true);
		void command({ type: "ui.response", response }).catch(() => setAnswered(false));
	};

	return (
		<Dialog open onOpenChange={(open) => !open && answer({ id: request.id, cancelled: true })}>
			<DialogContent size={request.method === "editor" ? "lg" : "md"} data-testid="ui-request">
				<DialogHeader>
					<div className="flex flex-wrap items-center gap-2">
						{approval ? (
							<Badge variant="warning">
								<ShieldCheck />
								{t("approval.label")}
							</Badge>
						) : (
							<Badge variant="outline">{t("ui.extensionRequest")}</Badge>
						)}
						{approval?.dangerous && <Badge variant="destructive">{t("approval.dangerous")}</Badge>}
						{remaining !== undefined && (
							<Badge variant={remaining <= 5 ? "warning" : "secondary"}>
								{t("ui.timeout", { seconds: remaining })}
							</Badge>
						)}
					</div>
					<DialogTitle className={approval ? "font-mono" : undefined}>
						{approval ? approval.toolName : heading}
					</DialogTitle>
					{request.method === "confirm" ? (
						<DialogDescription className="whitespace-pre-wrap">{request.message}</DialogDescription>
					) : (
						<DialogPrimitive.Description className="sr-only">{heading}</DialogPrimitive.Description>
					)}
				</DialogHeader>
				{detail && (
					<pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed">
						{detail}
					</pre>
				)}
				{request.method === "select" && (
					<UiSelectBody request={request} answer={answer} {...(shortcuts ? { shortcuts } : {})} />
				)}
				{request.method === "confirm" && (
					<DialogFooter>
						<Button variant="ghost" onClick={() => answer({ id: request.id, confirmed: false })}>
							{t("ui.no")}
						</Button>
						<Button onClick={() => answer({ id: request.id, confirmed: true })}>{t("ui.yes")}</Button>
					</DialogFooter>
				)}
				{request.method === "input" && <InputBody request={request} answer={answer} />}
				{request.method === "editor" && <EditorBody request={request} answer={answer} />}
				{shortcuts && <p className="text-[11px] text-muted-foreground">{t("approval.hint")}</p>}
			</DialogContent>
		</Dialog>
	);
}
