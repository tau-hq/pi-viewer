import { ShieldQuestion } from "lucide-react";
import { useEffect } from "react";
import { t } from "@/i18n";
import { useSessionStore } from "@/store/session-store";
import { needsTrustDecision, useTrustInfo, useTrustStore } from "@/store/trust-store";
import { Button } from "../ui/button";

/**
 * Discreet ask above the composer for a project that carries its own extensions, skills or
 * prompts and has no trust decision yet. pi only loads them from trusted directories.
 */
export function TrustBanner({ sessionId }: { sessionId: string }) {
	const cwd = useSessionStore((s) => s.views[sessionId]?.state.cwd);
	const info = useTrustInfo(cwd);
	const load = useTrustStore((s) => s.load);
	const decide = useTrustStore((s) => s.decide);

	useEffect(() => {
		if (cwd) void load(cwd);
	}, [cwd, load]);

	if (!cwd || !needsTrustDecision(info)) return null;
	return (
		<div
			data-testid="trust-banner"
			className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
		>
			<ShieldQuestion className="size-4 shrink-0 text-warning" />
			<span className="text-foreground">{t("trust.banner")}</span>
			<span className="text-muted-foreground">{t("trust.hint")}</span>
			<div className="flex-1" />
			<div className="flex shrink-0 items-center gap-2">
				<Button size="sm" variant="outline" data-testid="trust-reject" onClick={() => void decide(cwd, false)}>
					{t("trust.reject")}
				</Button>
				<Button size="sm" data-testid="trust-accept" onClick={() => void decide(cwd, true)}>
					{t("trust.trust")}
				</Button>
			</div>
		</div>
	);
}
