import type { AuthFlowEvent, AuthMethodInfo, AuthPrompt, AuthProviderInfo } from "@pi-tau/shared";
import { create } from "zustand";
import { t } from "@/i18n";
import { pickArray, pickString } from "@/lib/result-data";
import { getTransport } from "@/transport/transport";
import { useSessionsStore } from "./sessions-store";
import { toast } from "./ui-store";

/** A question of the running login flow, waiting for `auth.answer`. */
export interface PendingAuthPrompt {
	promptId: string;
	prompt: AuthPrompt;
}

/**
 * Client side of one provider login. Answers travel straight from the input to the host;
 * secrets are never part of this state.
 */
export interface LoginFlow {
	flowId: string;
	providerId: string;
	providerName: string;
	method: AuthMethodInfo["type"];
	prompt: PendingAuthPrompt | undefined;
	/** Flow events in arrival order; the dialog renders the last one of each kind. */
	events: AuthFlowEvent[];
	/** Set when the host reported a failure that the user did not cause. */
	error: string | undefined;
	/** True while an answer or the cancellation is on its way to the host. */
	busy: boolean;
	done: boolean;
}

/** Flows the user cancelled; the `auth.done` that follows must not surface as an error. */
const abandoned = new Set<string>();

interface AuthStoreState {
	providers: AuthProviderInfo[];
	loaded: boolean;
	loading: boolean;
	flow: LoginFlow | undefined;
	loadProviders: () => Promise<void>;
	startLogin: (provider: AuthProviderInfo, method: AuthMethodInfo["type"]) => Promise<void>;
	/** Send an answer for the pending prompt. The value is not kept anywhere. */
	answer: (value: string) => Promise<void>;
	cancel: () => void;
	/** Close the flow dialog. */
	dismiss: () => void;
	logout: (provider: AuthProviderInfo) => Promise<void>;
	handlePrompt: (flowId: string, promptId: string, prompt: AuthPrompt) => void;
	handleEvent: (flowId: string, event: AuthFlowEvent) => void;
	handleDone: (flowId: string, ok: boolean, error: string | undefined) => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Configured providers first, then by name. */
export function sortProviders(providers: readonly AuthProviderInfo[]): AuthProviderInfo[] {
	return [...providers].sort(
		(a, b) => (a.status ? 0 : 1) - (b.status ? 0 : 1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
	);
}

export const useAuthStore = create<AuthStoreState>()((set, get) => ({
	providers: [],
	loaded: false,
	loading: false,
	flow: undefined,

	loadProviders: async () => {
		set({ loading: true });
		try {
			const data = await getTransport().send({ type: "auth.providers" });
			set({ providers: sortProviders(pickArray<AuthProviderInfo>(data, "providers")), loaded: true });
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "auth.providers", message: errorMessage(error) }));
		} finally {
			set({ loading: false });
		}
	},

	startLogin: async (provider, method) => {
		set({
			flow: {
				flowId: "",
				providerId: provider.id,
				providerName: provider.name,
				method,
				prompt: undefined,
				events: [],
				error: undefined,
				busy: true,
				done: false,
			},
		});
		try {
			const data = await getTransport().send({ type: "auth.login", providerId: provider.id, method });
			const flowId = pickString(data, "flowId") ?? "";
			// Prompts can arrive before the result; keep whatever the handlers already stored.
			set((s) => (s.flow ? { flow: { ...s.flow, flowId: s.flow.flowId || flowId, busy: false } } : s));
		} catch (error) {
			set((s) => (s.flow ? { flow: { ...s.flow, busy: false, done: true, error: errorMessage(error) } } : s));
		}
	},

	answer: async (value) => {
		const flow = get().flow;
		const pending = flow?.prompt;
		if (!flow || !pending) return;
		set({ flow: { ...flow, prompt: undefined, busy: true } });
		try {
			await getTransport().send({ type: "auth.answer", flowId: flow.flowId, promptId: pending.promptId, value });
			set((s) => (s.flow && s.flow.flowId === flow.flowId ? { flow: { ...s.flow, busy: false } } : s));
		} catch (error) {
			set((s) =>
				s.flow && s.flow.flowId === flow.flowId
					? { flow: { ...s.flow, busy: false, done: true, error: errorMessage(error) } }
					: s,
			);
		}
	},

	cancel: () => {
		const flow = get().flow;
		if (!flow) return;
		set({ flow: undefined });
		if (!flow.flowId || flow.done) return;
		abandoned.add(flow.flowId);
		void getTransport()
			.send({ type: "auth.cancel", flowId: flow.flowId })
			.catch(() => undefined);
	},

	dismiss: () => set({ flow: undefined }),

	logout: async (provider) => {
		try {
			await getTransport().send({ type: "auth.logout", providerId: provider.id });
			toast("info", t("providers.loggedOut", { provider: provider.name }));
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "auth.logout", message: errorMessage(error) }));
		}
		await get().loadProviders();
		void useSessionsStore.getState().loadModels();
	},

	handlePrompt: (flowId, promptId, prompt) =>
		set((s) => {
			if (!s.flow || (s.flow.flowId && s.flow.flowId !== flowId)) return s;
			return { flow: { ...s.flow, flowId, prompt: { promptId, prompt }, busy: false } };
		}),

	handleEvent: (flowId, event) =>
		set((s) => {
			if (!s.flow || (s.flow.flowId && s.flow.flowId !== flowId)) return s;
			return { flow: { ...s.flow, flowId, events: [...s.flow.events, event], busy: false } };
		}),

	handleDone: (flowId, ok, error) => {
		const cancelledByUser = abandoned.delete(flowId);
		const flow = get().flow;
		if (cancelledByUser || (flow?.flowId && flow.flowId !== flowId)) return;
		if (ok) {
			const name = flow?.providerName ?? flow?.providerId ?? "";
			toast("info", t("login.success", { provider: name }));
			set({ flow: undefined });
			void get().loadProviders();
			void useSessionsStore.getState().loadModels();
			return;
		}
		if (!flow) return;
		set({ flow: { ...flow, prompt: undefined, busy: false, done: true, error: error ?? t("login.failed") } });
	},
}));
