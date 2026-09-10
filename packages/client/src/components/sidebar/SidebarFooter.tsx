import { KeyRound, Moon, Package, Settings, Sun } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { useConnectionStore } from "@/store/connection-store";
import { useUiStore } from "@/store/ui-store";
import { IconButton } from "../ui/icon-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function ConnectionDot({ className }: { className?: string }) {
	const status = useConnectionStore((s) => s.status);
	const host = useConnectionStore((s) => s.host);
	const label =
		status === "connected"
			? `${t("connection.connected")}${host ? ` · ${host.name} ${host.version} · pi ${host.piVersion}` : ""}`
			: status === "offline"
				? t("connection.offline")
				: t("connection.connecting");
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					role="status"
					aria-label={label}
					className={cn(
						"inline-block size-2 rounded-full",
						status === "connected" && "bg-success",
						status === "offline" && "bg-destructive",
						(status === "connecting" || status === "reconnecting") && "animate-glow bg-warning",
						className,
					)}
				/>
			</TooltipTrigger>
			<TooltipContent side="top">{label}</TooltipContent>
		</Tooltip>
	);
}

export function ThemeToggle() {
	const theme = useUiStore((s) => s.theme);
	const setTheme = useUiStore((s) => s.setTheme);
	return (
		<IconButton
			size="iconSm"
			label={theme === "dark" ? t("sidebar.toLight") : t("sidebar.toDark")}
			icon={theme === "dark" ? <Sun /> : <Moon />}
			onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
		/>
	);
}

/** Provider logins and pi's configuration files; both work without an open session. */
export function HostSettingsButtons() {
	const openDialog = useUiStore((s) => s.openDialog);
	return (
		<>
			<IconButton
				size="iconSm"
				label={t("sidebar.providers")}
				icon={<KeyRound />}
				onClick={() => openDialog("providers")}
			/>
			<IconButton
				size="iconSm"
				label={t("sidebar.packages")}
				icon={<Package />}
				onClick={() => openDialog("packages")}
			/>
			<IconButton
				size="iconSm"
				label={t("sidebar.configuration")}
				icon={<Settings />}
				onClick={() => openDialog("config")}
			/>
		</>
	);
}

export function SidebarFooter() {
	const status = useConnectionStore((s) => s.status);
	const host = useConnectionStore((s) => s.host);
	return (
		<div className="flex h-10 items-center gap-1 border-border border-t px-3 text-muted-foreground text-xs">
			<ConnectionDot className="mr-1" />
			<span className="min-w-0 flex-1 truncate">
				{status === "connected" ? (host ? `${host.name} · pi ${host.piVersion}` : t("connection.connected")) : null}
				{status === "connecting" && t("connection.connecting")}
				{status === "reconnecting" && t("connection.offline")}
				{status === "offline" && t("connection.offline")}
			</span>
			<HostSettingsButtons />
			<ThemeToggle />
		</div>
	);
}
