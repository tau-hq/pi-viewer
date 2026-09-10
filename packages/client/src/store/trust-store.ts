import type { TrustInfo } from "@pi-tau/shared";
import { create } from "zustand";
import { t } from "@/i18n";
import { asRecord } from "@/lib/result-data";
import { getTransport } from "@/transport/transport";
import { toast } from "./ui-store";

/** `null` decision means undecided: pi asks before it loads a project's own resources. */
export type TrustDecision = boolean | null;

function toTrustInfo(data: unknown, cwd: string): TrustInfo {
	const record = asRecord(data) ?? {};
	const decision = record.decision;
	return {
		cwd: typeof record.cwd === "string" ? record.cwd : cwd,
		decision: typeof decision === "boolean" ? decision : null,
		hasProjectResources: record.hasProjectResources === true,
	};
}

/**
 * A project asks for a trust decision when it ships resources of its own and nobody has
 * decided yet. Undecided projects are the only ones the banner interrupts for.
 */
export function needsTrustDecision(info: TrustInfo | undefined): boolean {
	return info?.hasProjectResources === true && info.decision === null;
}

interface TrustStoreState {
	/** Trust info per working directory, as last reported by the host. */
	infos: Record<string, TrustInfo>;
	pending: Record<string, boolean>;
	/** Read the decision for a directory; already loaded directories are only re-read when forced. */
	load: (cwd: string, force?: boolean) => Promise<TrustInfo | undefined>;
	/** Store a decision (`null` asks again next time). */
	decide: (cwd: string, trusted: TrustDecision) => Promise<void>;
}

export const useTrustStore = create<TrustStoreState>()((set, get) => ({
	infos: {},
	pending: {},

	load: async (cwd, force = false) => {
		if (!cwd) return undefined;
		const existing = get().infos[cwd];
		if (existing && !force) return existing;
		if (get().pending[cwd]) return existing;
		set((s) => ({ pending: { ...s.pending, [cwd]: true } }));
		try {
			const data = await getTransport().send({ type: "trust.get", cwd });
			const info = toTrustInfo(data, cwd);
			set((s) => ({ infos: { ...s.infos, [cwd]: info } }));
			return info;
		} catch {
			// An older host does not know trust; the banner then simply never appears.
			return undefined;
		} finally {
			set((s) => ({ pending: { ...s.pending, [cwd]: false } }));
		}
	},

	decide: async (cwd, trusted) => {
		try {
			const data = await getTransport().send({ type: "trust.set", cwd, trusted });
			const info = toTrustInfo(data, cwd);
			set((s) => ({ infos: { ...s.infos, [cwd]: { ...info, decision: trusted } } }));
			const message =
				trusted === null ? t("trust.toastReset") : trusted ? t("trust.toastTrusted") : t("trust.toastRejected");
			toast("info", message);
		} catch (error) {
			toast("error", t("toast.commandFailed", { command: "trust.set", message: String(error) }));
		}
	},
}));

export function useTrustInfo(cwd: string | undefined): TrustInfo | undefined {
	return useTrustStore((s) => (cwd ? s.infos[cwd] : undefined));
}
