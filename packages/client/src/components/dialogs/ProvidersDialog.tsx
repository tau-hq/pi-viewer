import type { AuthMethodInfo, AuthProviderInfo } from "@pi-tau/shared";
import { KeyRound, LogOut, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { useAuthStore } from "@/store/auth-store";
import { useUiStore } from "@/store/ui-store";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { IconButton } from "../ui/icon-button";
import { Spinner } from "../ui/spinner";
import { ConfirmDialog } from "./ConfirmDialog";

function methodLabel(method: AuthMethodInfo): string {
	return method.type === "api_key" ? t("providers.apiKey") : t("providers.signIn");
}

function statusLabel(status: NonNullable<AuthProviderInfo["status"]>): string {
	const type = status.type === "api_key" ? t("providers.apiKey") : t("providers.oauth");
	return status.source ? `${type} · ${status.source}` : type;
}

function ProviderRow({ provider, onLogout }: { provider: AuthProviderInfo; onLogout: () => void }) {
	const startLogin = useAuthStore((s) => s.startLogin);
	return (
		<div
			data-testid="provider-row"
			data-provider={provider.id}
			className="flex items-center gap-3 border-border border-b px-3 py-2 last:border-b-0"
		>
			<div className="min-w-0 flex-1">
				<span className="block truncate text-sm">{provider.name}</span>
				<span className="block truncate font-mono text-[11px] text-muted-foreground">{provider.id}</span>
			</div>
			{provider.status && (
				<Badge variant="success" title={statusLabel(provider.status)}>
					{t("providers.configured")} · {statusLabel(provider.status)}
				</Badge>
			)}
			{provider.methods.map((method) => (
				<Button
					key={`${method.type}:${method.label}`}
					size="sm"
					variant="outline"
					title={method.label}
					onClick={() => void startLogin(provider, method.type)}
				>
					{methodLabel(method)}
					{method.subscription && <Badge variant="secondary">{t("providers.subscription")}</Badge>}
				</Button>
			))}
			{provider.status && (
				<IconButton size="iconSm" label={t("providers.logout")} icon={<LogOut />} onClick={onLogout} />
			)}
		</div>
	);
}

/** Provider list with the login methods pi offers; configured providers come first. */
export function ProvidersDialog() {
	const open = useUiStore((s) => s.dialog === "providers");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const providers = useAuthStore((s) => s.providers);
	const loaded = useAuthStore((s) => s.loaded);
	const loading = useAuthStore((s) => s.loading);
	const loadProviders = useAuthStore((s) => s.loadProviders);
	const logout = useAuthStore((s) => s.logout);
	const [logoutTarget, setLogoutTarget] = useState<AuthProviderInfo | undefined>(undefined);

	useEffect(() => {
		if (open) void loadProviders();
	}, [open, loadProviders]);

	return (
		<>
			<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
				<DialogContent data-testid="providers-dialog" size="lg">
					<DialogHeader>
						<div className="flex items-center gap-2">
							<KeyRound className="size-4 text-muted-foreground" />
							<DialogTitle>{t("providers.title")}</DialogTitle>
							{loading && <Spinner />}
							<div className="flex-1" />
							<IconButton
								size="iconSm"
								label={t("providers.reload")}
								icon={<RotateCw />}
								disabled={loading}
								onClick={() => void loadProviders()}
							/>
						</div>
						<DialogDescription>{t("providers.description")}</DialogDescription>
					</DialogHeader>
					<div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
						{!loaded && loading && (
							<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
								<Spinner /> {t("providers.loading")}
							</div>
						)}
						{loaded && providers.length === 0 && (
							<p className="p-6 text-center text-muted-foreground text-sm">{t("providers.empty")}</p>
						)}
						{providers.map((provider) => (
							<ProviderRow key={provider.id} provider={provider} onLogout={() => setLogoutTarget(provider)} />
						))}
					</div>
				</DialogContent>
			</Dialog>
			<ConfirmDialog
				open={logoutTarget !== undefined}
				title={t("providers.logoutTitle", { provider: logoutTarget?.name ?? "" })}
				description={t("providers.logoutDescription")}
				confirmLabel={t("providers.logout")}
				destructive
				onCancel={() => setLogoutTarget(undefined)}
				onConfirm={() => {
					const target = logoutTarget;
					setLogoutTarget(undefined);
					if (target) void logout(target);
				}}
			/>
		</>
	);
}
