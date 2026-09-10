import type { AuthFlowEvent, AuthPrompt } from "@pi-tau/shared";
import { Check, Copy, ExternalLink, TriangleAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { t } from "@/i18n";
import { copyText } from "@/lib/download";
import { type LoginFlow, useAuthStore } from "@/store/auth-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

function last<T extends AuthFlowEvent["type"]>(
	events: readonly AuthFlowEvent[],
	type: T,
): Extract<AuthFlowEvent, { type: T }> | undefined {
	const matches = events.filter((event): event is Extract<AuthFlowEvent, { type: T }> => event.type === type);
	return matches.at(-1);
}

function CopyButton({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={() => {
				void copyText(value).then((ok) => {
					if (!ok) return;
					setCopied(true);
					setTimeout(() => setCopied(false), 1500);
				});
			}}
		>
			{copied ? <Check /> : <Copy />}
			{copied ? t("transcript.copied") : t("login.copy")}
		</Button>
	);
}

function ExternalLinkButton({ url, label }: { url: string; label?: string }) {
	return (
		<Button variant="outline" size="sm" asChild>
			<a href={url} target="_blank" rel="noreferrer noopener">
				<ExternalLink />
				{label ?? t("login.open")}
			</a>
		</Button>
	);
}

function AuthUrlBlock({ event }: { event: Extract<AuthFlowEvent, { type: "auth_url" }> }) {
	return (
		<div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
			{event.instructions && <p className="text-sm">{event.instructions}</p>}
			<div className="flex items-center gap-2">
				<ExternalLinkButton url={event.url} />
				<CopyButton value={event.url} />
			</div>
			<code className="block break-all font-mono text-[11px] text-muted-foreground">{event.url}</code>
		</div>
	);
}

function DeviceCodeBlock({ event }: { event: Extract<AuthFlowEvent, { type: "device_code" }> }) {
	const [remaining, setRemaining] = useState<number | undefined>(undefined);
	useEffect(() => {
		const total = event.expiresInSeconds;
		if (total === undefined) {
			setRemaining(undefined);
			return;
		}
		const deadline = Date.now() + total * 1000;
		const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [event]);

	return (
		<div className="flex flex-col items-center gap-2 rounded-md border border-border bg-muted/40 p-4">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">{t("login.userCode")}</span>
			<span data-testid="device-code" className="select-all font-mono font-semibold text-2xl tracking-[0.3em]">
				{event.userCode}
			</span>
			<p className="text-center text-muted-foreground text-xs">{t("login.verifyAt", { url: event.verificationUri })}</p>
			<div className="flex items-center gap-2">
				<ExternalLinkButton url={event.verificationUri} />
				<CopyButton value={event.userCode} />
			</div>
			{remaining !== undefined && (
				<Badge variant={remaining === 0 ? "destructive" : remaining <= 60 ? "warning" : "secondary"}>
					{remaining === 0 ? t("login.expired") : t("login.expiresIn", { seconds: remaining })}
				</Badge>
			)}
		</div>
	);
}

function InfoBlock({ event }: { event: Extract<AuthFlowEvent, { type: "info" }> }) {
	return (
		<div className="flex flex-col gap-2 text-sm">
			<p className="whitespace-pre-wrap">{event.message}</p>
			{event.links && event.links.length > 0 && (
				<div className="flex flex-wrap items-center gap-2">
					{event.links.map((link) => (
						<ExternalLinkButton key={link.url} url={link.url} {...(link.label ? { label: link.label } : {})} />
					))}
				</div>
			)}
		</div>
	);
}

type TextPrompt = Extract<AuthPrompt, { type: "text" | "secret" | "manual_code" }>;

interface PromptFormProps {
	prompt: TextPrompt;
	disabled: boolean;
	onCancel: () => void;
}

/** Text, secret and manual code prompts. The typed value stays in this component. */
function PromptForm({ prompt, disabled, onCancel }: PromptFormProps) {
	const answer = useAuthStore((s) => s.answer);
	const [value, setValue] = useState("");
	const secret = prompt.type === "secret";

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!value) return;
		setValue("");
		void answer(value);
	};

	return (
		<form onSubmit={submit} className="flex flex-col gap-2">
			<label htmlFor="auth-prompt-value" className="text-sm">
				{prompt.message}
			</label>
			<Input
				id="auth-prompt-value"
				data-testid={secret ? "auth-secret" : "auth-text"}
				type={secret ? "password" : "text"}
				autoComplete="off"
				spellCheck={false}
				value={value}
				disabled={disabled}
				placeholder={prompt.placeholder}
				onChange={(e) => setValue(e.target.value)}
			/>
			{secret && <p className="text-[11px] text-muted-foreground">{t("login.secretHint")}</p>}
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onCancel}>
					{t("ui.cancel")}
				</Button>
				<Button type="submit" disabled={disabled || value.length === 0}>
					{t("login.send")}
				</Button>
			</DialogFooter>
		</form>
	);
}

function SelectPrompt({ prompt, disabled }: { prompt: Extract<AuthPrompt, { type: "select" }>; disabled: boolean }) {
	const answer = useAuthStore((s) => s.answer);
	return (
		<div className="flex flex-col gap-2">
			<p className="text-sm">{prompt.message}</p>
			<div className="overflow-hidden rounded-md border border-border">
				{prompt.options.map((option) => (
					<button
						key={option.id}
						type="button"
						disabled={disabled}
						onClick={() => void answer(option.id)}
						className="flex w-full flex-col items-start gap-0.5 border-border border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent disabled:opacity-60"
					>
						<span>{option.label}</span>
						{option.description && <span className="text-muted-foreground text-xs">{option.description}</span>}
					</button>
				))}
			</div>
		</div>
	);
}

function FlowBody({ flow, onClose }: { flow: LoginFlow; onClose: () => void }) {
	const info = last(flow.events, "info");
	const authUrl = last(flow.events, "auth_url");
	const device = last(flow.events, "device_code");
	const progress = last(flow.events, "progress");
	const pending = flow.prompt;
	const textPrompt = pending && pending.prompt.type !== "select" ? pending.prompt : undefined;
	const idle = !pending && !flow.error;

	return (
		<div className="flex flex-col gap-3">
			{flow.error && (
				<div
					data-testid="login-error"
					className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive text-sm"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0" />
					<span className="min-w-0 break-words">{flow.error}</span>
				</div>
			)}
			{info && <InfoBlock event={info} />}
			{device && <DeviceCodeBlock event={device} />}
			{authUrl && <AuthUrlBlock event={authUrl} />}
			{pending?.prompt.type === "select" && <SelectPrompt prompt={pending.prompt} disabled={flow.busy} />}
			{pending && textPrompt && (
				<PromptForm key={pending.promptId} prompt={textPrompt} disabled={flow.busy} onCancel={onClose} />
			)}
			{idle && (
				<p className="flex items-center gap-2 text-muted-foreground text-sm">
					<Spinner /> {progress?.message ?? t("login.waiting")}
				</p>
			)}
			{!textPrompt && (
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						{flow.done ? t("ui.close") : t("ui.cancel")}
					</Button>
				</DialogFooter>
			)}
		</div>
	);
}

/** Modal for the running provider login: renders prompts and events as they arrive. */
export function LoginFlowDialog() {
	const flow = useAuthStore((s) => s.flow);
	const cancel = useAuthStore((s) => s.cancel);
	const dismiss = useAuthStore((s) => s.dismiss);
	const close = () => (flow?.done ? dismiss() : cancel());

	return (
		<Dialog open={flow !== undefined} onOpenChange={(next) => !next && close()}>
			<DialogContent data-testid="login-dialog">
				<DialogHeader>
					<DialogTitle>{t("login.title", { provider: flow?.providerName ?? "" })}</DialogTitle>
					<DialogDescription>{flow?.providerId ?? ""}</DialogDescription>
				</DialogHeader>
				{flow && <FlowBody flow={flow} onClose={close} />}
			</DialogContent>
		</Dialog>
	);
}
