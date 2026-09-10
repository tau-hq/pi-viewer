import { randomUUID } from "node:crypto";
import type { AuthFlowEvent, AuthPrompt, HostEnvelope } from "@pi-tau/shared";
import { createLogger } from "../logger.js";
import { login, type SdkAuthEvent, type SdkAuthInteraction, type SdkAuthPrompt } from "../pi-sdk.js";

const log = createLogger("auth");

interface PendingPrompt {
	resolve: (value: string) => void;
	reject: (error: Error) => void;
}

interface Flow {
	providerId: string;
	controller: AbortController;
	prompts: Map<string, PendingPrompt>;
	emit: (envelope: HostEnvelope) => void;
	/** Set when the client cancelled, so the resulting abort is not reported as a failure. */
	cancelled: boolean;
}

function toWirePrompt(prompt: SdkAuthPrompt): AuthPrompt {
	switch (prompt.type) {
		case "select":
			return { type: "select", message: prompt.message, options: prompt.options.map((o) => ({ ...o })) };
		case "text":
		case "secret":
		case "manual_code": {
			const out: Extract<AuthPrompt, { type: "text" | "secret" | "manual_code" }> = {
				type: prompt.type,
				message: prompt.message,
			};
			if (prompt.placeholder !== undefined) out.placeholder = prompt.placeholder;
			return out;
		}
	}
}

/**
 * Runs provider login flows through pi's SDK, relaying prompts and events to the
 * client that started the flow. Secrets typed by the user travel client -> host ->
 * pi's credential store only; the host never logs them.
 */
export type LoginFunction = (
	providerId: string,
	method: "api_key" | "oauth",
	interaction: SdkAuthInteraction,
) => Promise<void>;

export class AuthFlows {
	private readonly flows = new Map<string, Flow>();

	/** `loginFn` defaults to pi's SDK; tests inject a fake. */
	constructor(private readonly loginFn: LoginFunction = login) {}

	start(providerId: string, method: "api_key" | "oauth", emit: (envelope: HostEnvelope) => void): { flowId: string } {
		const flowId = randomUUID();
		const flow: Flow = { providerId, controller: new AbortController(), prompts: new Map(), emit, cancelled: false };
		this.flows.set(flowId, flow);
		const interaction = {
			signal: flow.controller.signal,
			prompt: (prompt: SdkAuthPrompt): Promise<string> =>
				new Promise<string>((resolve, reject) => {
					const promptId = randomUUID();
					flow.prompts.set(promptId, { resolve, reject });
					prompt.signal?.addEventListener("abort", () => {
						if (flow.prompts.delete(promptId)) reject(new Error("prompt aborted"));
					});
					emit({ type: "auth.prompt", flowId, promptId, prompt: toWirePrompt(prompt) });
				}),
			notify: (event: SdkAuthEvent): void => {
				emit({ type: "auth.event", flowId, event: JSON.parse(JSON.stringify(event)) as AuthFlowEvent });
			},
		};
		log.info(`login flow ${flowId} for ${providerId} (${method})`);
		this.loginFn(providerId, method, interaction)
			.then(() => {
				emit({ type: "auth.done", flowId, ok: true });
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				if (flow.cancelled) {
					log.info(`login flow ${flowId} cancelled by the client`);
					emit({ type: "auth.done", flowId, ok: false, cancelled: true, error: message });
					return;
				}
				log.warn(`login flow ${flowId} failed: ${message}`);
				emit({ type: "auth.done", flowId, ok: false, error: message });
			})
			.finally(() => {
				for (const pending of flow.prompts.values()) pending.reject(new Error("flow finished"));
				this.flows.delete(flowId);
			});
		return { flowId };
	}

	answer(flowId: string, promptId: string, value: string): void {
		const flow = this.flows.get(flowId);
		const pending = flow?.prompts.get(promptId);
		if (!flow || !pending) throw new Error("no pending prompt for that flow");
		flow.prompts.delete(promptId);
		pending.resolve(value);
	}

	cancel(flowId: string): void {
		const flow = this.flows.get(flowId);
		if (!flow) return;
		flow.cancelled = true;
		for (const [id, pending] of flow.prompts) {
			flow.prompts.delete(id);
			pending.reject(new Error("cancelled by user"));
		}
		flow.controller.abort();
	}

	/** Cancel flows owned by a disconnected client. */
	cancelAllFor(emit: (envelope: HostEnvelope) => void): void {
		for (const [flowId, flow] of this.flows) if (flow.emit === emit) this.cancel(flowId);
	}
}
