import { Plus, SquareTerminal, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { closeTerminal, type TerminalKind, type TerminalTab } from "@/store/terminal-store";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { IconButton } from "../ui/icon-button";

interface TerminalTabsProps {
	tabs: TerminalTab[];
	activeKey: string | undefined;
	onSelect: (key: string) => void;
	onCreate: (kind: TerminalKind) => void;
	onHide: () => void;
}

function tabLabel(tab: TerminalTab): string {
	return tab.kind === "pi" ? t("terminal.tabPi") : t("terminal.shell");
}

/** Tab strip of the terminal panel: one tab per terminal, a "+" menu and the hide button. */
export function TerminalTabs({ tabs, activeKey, onSelect, onCreate, onHide }: TerminalTabsProps) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-1 border-border border-b bg-card/40 pr-1 pl-1">
			<SquareTerminal className="mx-1 size-3.5 shrink-0 text-muted-foreground" />
			<div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
				{tabs.map((tab) => (
					<div
						key={tab.key}
						data-testid="terminal-tab"
						data-kind={tab.kind}
						data-alive={tab.alive}
						className={cn(
							"group flex h-6 shrink-0 items-center rounded-md pr-0.5 pl-2 text-xs transition-colors",
							tab.key === activeKey ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
						)}
					>
						<button type="button" className="flex items-center gap-1.5 font-mono" onClick={() => onSelect(tab.key)}>
							{!tab.alive && (
								<span
									data-testid="terminal-exited-dot"
									title={t("terminal.exitedUnknown")}
									className="size-1.5 rounded-full bg-warning"
								/>
							)}
							{tabLabel(tab)}
						</button>
						<button
							type="button"
							aria-label={t("terminal.close")}
							className="ml-1 flex size-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-background/60 focus-visible:opacity-100 group-hover:opacity-100"
							onClick={() => void closeTerminal(tab)}
						>
							<X className="size-3" />
						</button>
					</div>
				))}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<span>
							<IconButton size="iconSm" label={t("terminal.newTerminal")} icon={<Plus />} />
						</span>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="min-w-40">
						<DropdownMenuItem data-testid="terminal-new-shell" onSelect={() => onCreate("shell")}>
							{t("terminal.shell")}
						</DropdownMenuItem>
						<DropdownMenuItem data-testid="terminal-new-pi" onSelect={() => onCreate("pi")}>
							{t("terminal.pi")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			<IconButton size="iconSm" label={t("terminal.hide")} icon={<X />} onClick={onHide} />
		</div>
	);
}
