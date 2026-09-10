import { Shield } from "lucide-react";
import { useEffect } from "react";
import { t } from "@/i18n";
import { useTrustInfo, useTrustStore } from "@/store/trust-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function decisionBadge(decision: boolean | null) {
	if (decision === true) return { variant: "success" as const, label: t("trust.trusted") };
	if (decision === false) return { variant: "warning" as const, label: t("trust.rejected") };
	return { variant: "outline" as const, label: t("trust.undecided") };
}

/** Trust state of the current project inside the configuration dialog, with a way to change it. */
export function TrustSection({ cwd }: { cwd: string | undefined }) {
	const info = useTrustInfo(cwd);
	const load = useTrustStore((s) => s.load);
	const decide = useTrustStore((s) => s.decide);

	useEffect(() => {
		// Force a read: the decision may have been made elsewhere since the last look.
		if (cwd) void load(cwd, true);
	}, [cwd, load]);

	if (!cwd) return null;
	const badge = decisionBadge(info?.decision ?? null);
	return (
		<section data-testid="trust-section" className="rounded-md border border-border p-3">
			<div className="flex flex-wrap items-center gap-2">
				<Shield className="size-4 text-muted-foreground" />
				<h3 className="font-medium text-sm">{t("trust.title")}</h3>
				<Badge data-testid="trust-decision" variant={badge.variant}>
					{badge.label}
				</Badge>
				<div className="flex-1" />
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						data-testid="trust-section-reset"
						disabled={info?.decision === null || info === undefined}
						onClick={() => void decide(cwd, null)}
					>
						{t("trust.askAgain")}
					</Button>
					<Button
						size="sm"
						variant="outline"
						data-testid="trust-section-reject"
						disabled={info?.decision === false}
						onClick={() => void decide(cwd, false)}
					>
						{t("trust.reject")}
					</Button>
					<Button
						size="sm"
						data-testid="trust-section-trust"
						disabled={info?.decision === true}
						onClick={() => void decide(cwd, true)}
					>
						{t("trust.trust")}
					</Button>
				</div>
			</div>
			<span data-testid="trust-cwd" className="mt-2 block truncate font-mono text-[11px] text-muted-foreground">
				{cwd}
			</span>
			<p className="mt-1 text-[11px] text-muted-foreground">
				{info?.hasProjectResources ? t("trust.resources") : t("trust.noResources")} {t("trust.description")}{" "}
				{t("trust.hint")}
			</p>
		</section>
	);
}
