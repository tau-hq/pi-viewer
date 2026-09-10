import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, PanelLeftOpen, Plus } from "lucide-react";
import { useRef } from "react";
import { t } from "@/i18n";
import { useNarrow } from "@/lib/media-query";
import { useUiStore } from "@/store/ui-store";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { ConnectionDot, HostSettingsButtons, ThemeToggle } from "./SidebarFooter";
import { SidebarPanel } from "./SidebarPanel";

function Rail() {
	const toggle = useUiStore((s) => s.toggleSidebar);
	const openDialog = useUiStore((s) => s.openDialog);
	return (
		<aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-border border-r bg-card/40 py-2">
			<IconButton label={t("sidebar.expand")} icon={<PanelLeftOpen />} onClick={toggle} side="right" />
			<IconButton
				label={t("sidebar.newSession")}
				icon={<Plus />}
				onClick={() => openDialog("newSession")}
				side="right"
				hint={<Kbd>Ctrl+Shift+N</Kbd>}
			/>
			<div className="flex-1" />
			<HostSettingsButtons />
			<ThemeToggle />
			<div className="flex h-8 items-center">
				<ConnectionDot />
			</div>
		</aside>
	);
}

/** Sidebar as an overlay for narrow layouts: backdrop click, Esc and navigation close it. */
function Drawer() {
	const open = useUiStore((s) => s.drawerOpen);
	const setOpen = useUiStore((s) => s.setDrawerOpen);
	const panelRef = useRef<HTMLDivElement>(null);
	return (
		<DialogPrimitive.Root open={open} onOpenChange={setOpen}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay
					data-testid="drawer-backdrop"
					className="data-[state=open]:fade-in-0 data-[state=open]:animate-in fixed inset-0 z-40 bg-black/50"
				/>
				<DialogPrimitive.Content
					ref={panelRef}
					data-testid="drawer"
					aria-describedby={undefined}
					// Focus the panel, not its first button: a focused icon button opens its tooltip,
					// which would become the top layer and eat the first Escape.
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						panelRef.current?.focus();
					}}
					className="data-[state=open]:animate-in fixed inset-y-0 left-0 z-40 flex w-[280px] max-w-[85vw] flex-col border-border border-r bg-background shadow-xl outline-none"
				>
					<DialogPrimitive.Title className="sr-only">{t("app.title")}</DialogPrimitive.Title>
					<SidebarPanel variant="drawer" onClose={() => setOpen(false)} />
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** Hamburger for narrow layouts; hidden by CSS on wide ones. */
export function DrawerButton({ className }: { className?: string }) {
	const setOpen = useUiStore((s) => s.setDrawerOpen);
	return (
		<IconButton
			className={className ?? "md:hidden"}
			label={t("sidebar.open")}
			icon={<Menu />}
			onClick={() => setOpen(true)}
		/>
	);
}

export function Sidebar() {
	const narrow = useNarrow();
	const open = useUiStore((s) => s.sidebarOpen);
	const toggle = useUiStore((s) => s.toggleSidebar);
	if (narrow) return <Drawer />;
	if (!open) return <Rail />;
	return (
		<aside className="flex w-[260px] shrink-0 flex-col border-border border-r bg-card/40">
			<SidebarPanel variant="docked" onClose={toggle} />
		</aside>
	);
}
