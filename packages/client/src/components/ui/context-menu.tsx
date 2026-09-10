import * as ContextMenuPrimitive from "@radix-ui/react-context-menu";
import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { MENU_CONTENT_CLASS, MENU_DESTRUCTIVE_CLASS, MENU_ITEM_CLASS, MenuCheck } from "./dropdown-menu";

/**
 * Right-click menu. Same primitive family and the same three class strings as the dropdown
 * menu, so a context menu and a "…" menu of the same items look identical.
 */
export const ContextMenu = ContextMenuPrimitive.Root;
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger;
export const ContextMenuSub = ContextMenuPrimitive.Sub;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Content>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.Content
				className={cn(MENU_CONTENT_CLASS, "max-h-[var(--radix-context-menu-content-available-height)]", className)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	);
}

interface ItemProps extends ComponentProps<typeof ContextMenuPrimitive.Item> {
	destructive?: boolean;
	/** Renders a check mark when true and reserves the space otherwise. */
	checked?: boolean;
}

export function ContextMenuItem({ className, destructive, checked, children, ...props }: ItemProps) {
	return (
		<ContextMenuPrimitive.Item
			className={cn(MENU_ITEM_CLASS, destructive && MENU_DESTRUCTIVE_CLASS, className)}
			{...props}
		>
			{checked !== undefined && <MenuCheck checked={checked} />}
			{children}
		</ContextMenuPrimitive.Item>
	);
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
	return <ContextMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function ContextMenuSubTrigger({
	className,
	children,
	...props
}: ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
	return (
		<ContextMenuPrimitive.SubTrigger
			className={cn(MENU_ITEM_CLASS, "data-[state=open]:bg-accent data-[state=open]:text-accent-foreground", className)}
			{...props}
		>
			{children}
			<ChevronRight className="ml-auto opacity-60" />
		</ContextMenuPrimitive.SubTrigger>
	);
}

export function ContextMenuSubContent({
	className,
	sideOffset = 4,
	...props
}: ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
	return (
		<ContextMenuPrimitive.Portal>
			<ContextMenuPrimitive.SubContent
				sideOffset={sideOffset}
				className={cn(MENU_CONTENT_CLASS, "max-h-[var(--radix-context-menu-content-available-height)]", className)}
				{...props}
			/>
		</ContextMenuPrimitive.Portal>
	);
}
