import type { HostInfo } from "@pi-tau/shared";
import { create } from "zustand";
import type { ConnectionStatus } from "@/transport/ws";

interface ConnectionStoreState {
	status: ConnectionStatus;
	attempt: number;
	host: HostInfo | undefined;
	lastError: string | undefined;
	setStatus: (status: ConnectionStatus, attempt: number) => void;
	setHost: (host: HostInfo) => void;
	setError: (message: string | undefined) => void;
}

export const useConnectionStore = create<ConnectionStoreState>()((set) => ({
	status: "connecting",
	attempt: 0,
	host: undefined,
	lastError: undefined,
	setStatus: (status, attempt) => set({ status, attempt }),
	setHost: (host) => set({ host, lastError: undefined }),
	setError: (lastError) => set({ lastError }),
}));
