import { Download, FileCode, FileDown } from "lucide-react";
import { t } from "@/i18n";
import { exportSessionHtml, exportSessionJsonl } from "@/store/sessions-store";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { IconButton } from "../ui/icon-button";

/**
 * Both downloads of a session behind one header button. The JSONL file is read straight from
 * disk and works without a process; the HTML export is rendered by pi and needs one.
 */
export function ExportMenu({ sessionId, alive }: { sessionId: string; alive: boolean }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<span>
					<IconButton label={t("header.export")} icon={<Download />} data-testid="header-export" />
				</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-44" data-testid="export-menu">
				<DropdownMenuItem
					data-testid="menu-export-jsonl"
					onSelect={() => void exportSessionJsonl(sessionId).catch(() => undefined)}
				>
					<FileDown /> {t("header.exportJsonl")}
				</DropdownMenuItem>
				<DropdownMenuItem
					data-testid="menu-export-html"
					disabled={!alive}
					onSelect={() => void exportSessionHtml(sessionId).catch(() => undefined)}
				>
					<FileCode /> {t("header.downloadHtml")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
