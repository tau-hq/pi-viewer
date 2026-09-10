import { TAU_PROTOCOL_VERSION } from "@pi-tau/shared";
import { WifiOff } from "lucide-react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { Spinner } from "./ui/spinner";

export function ConnectionBanner() {
	const status = useConnectionStore((s) => s.status);
	const attempt = useConnectionStore((s) => s.attempt);
	const lastError = useConnectionStore((s) => s.lastError);
	if (status === "connected") return null;

	let text: string;
	if (status === "connecting") text = t("connection.connecting");
	else if (status === "reconnecting") text = t("connection.reconnecting", { attempt });
	else {
		const mismatch = lastError?.match(/host (\d+), client (\d+)/);
		text = mismatch
			? t("connection.incompatible", { hostVersion: mismatch[1] ?? "?", clientVersion: TAU_PROTOCOL_VERSION })
			: `${t("connection.offline")}${lastError ? ` · ${lastError}` : ""}`;
	}

	return (
		<div
			role="status"
			className="flex items-center gap-2 border-warning/30 border-b bg-warning/10 px-4 py-1.5 text-warning text-xs"
		>
			{status === "offline" ? <WifiOff className="size-3.5" /> : <Spinner className="size-3.5 text-warning" />}
			<span>{text}</span>
		</div>
	);
}
