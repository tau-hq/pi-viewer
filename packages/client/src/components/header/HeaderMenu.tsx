import {
	BookOpen,
	Download,
	Ellipsis,
	FileDown,
	GitBranch,
	GitFork,
	Keyboard,
	Layers,
	Newspaper,
	Package,
	RefreshCw,
	SlidersHorizontal,
	Wrench,
} from "lucide-react";
import { t } from "@/i18n";
import { exportSessionHtml, exportSessionJsonl, useSessionsStore } from "@/store/sessions-store";
import { toast, useUiStore } from "@/store/ui-store";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { IconButton } from "../ui/icon-button";

interface HeaderMenuProps {
	sessionId: string;
	alive: boolean;
}

/**
 * Overflow menu of session actions. On wide layouts the first group is also available as
 * header icons, so those entries only show below the md breakpoint.
 */
export function HeaderMenu({ sessionId, alive }: HeaderMenuProps) {
	const openDialog = useUiStore((s) => s.openDialog);
	const command = useSessionsStore((s) => s.command);

	const reloadResources = async () => {
		await command({ type: "reloadResources" });
		toast("info", t("toast.resourcesReloaded"));
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<span>
					<IconButton label={t("header.more")} icon={<Ellipsis />} />
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44">
				<DropdownMenuItem className="md:hidden" disabled={!alive} onSelect={() => openDialog("tools")}>
					<Wrench /> {t("header.tools")}
				</DropdownMenuItem>
				<DropdownMenuItem className="md:hidden" disabled={!alive} onSelect={() => openDialog("tree")}>
					<GitBranch /> {t("header.tree")}
				</DropdownMenuItem>
				<DropdownMenuItem className="md:hidden" disabled={!alive} onSelect={() => openDialog("fork")}>
					<GitFork /> {t("header.fork")}
				</DropdownMenuItem>
				<DropdownMenuItem className="md:hidden" disabled={!alive} onSelect={() => openDialog("compact")}>
					<Layers /> {t("header.compact")}
				</DropdownMenuItem>
				<DropdownMenuItem
					className="md:hidden"
					onSelect={() => void exportSessionJsonl(sessionId).catch(() => undefined)}
				>
					<FileDown /> {t("header.exportJsonl")}
				</DropdownMenuItem>
				<DropdownMenuItem
					className="md:hidden"
					disabled={!alive}
					onSelect={() => void exportSessionHtml(sessionId).catch(() => undefined)}
				>
					<Download /> {t("header.downloadHtml")}
				</DropdownMenuItem>
				<DropdownMenuSeparator className="md:hidden" />
				<DropdownMenuItem data-testid="menu-commands" disabled={!alive} onSelect={() => openDialog("commands")}>
					<BookOpen /> {t("header.commands")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					data-testid="menu-session-settings"
					disabled={!alive}
					onSelect={() => openDialog("sessionSettings")}
				>
					<SlidersHorizontal /> {t("header.sessionSettings")}
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="menu-packages" onSelect={() => openDialog("packages")}>
					<Package /> {t("header.packages")}
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="menu-reload-resources"
					disabled={!alive}
					onSelect={() => void reloadResources().catch(() => undefined)}
				>
					<RefreshCw /> {t("header.reloadResources")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem data-testid="menu-hotkeys" onSelect={() => openDialog("hotkeys")}>
					<Keyboard /> {t("header.hotkeys")}
				</DropdownMenuItem>
				<DropdownMenuItem data-testid="menu-changelog" onSelect={() => openDialog("changelog")}>
					<Newspaper /> {t("header.changelog")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
