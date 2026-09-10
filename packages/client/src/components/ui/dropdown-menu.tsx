import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
	className,
	sideOffset = 6,
	...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					"data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[10rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

interface ItemProps extends ComponentProps<typeof DropdownMenuPrimitive.Item> {
	destructive?: boolean;
	/** Renders a check mark when true and reserves the space otherwise. */
	checked?: boolean;
}

export function DropdownMenuItem({ className, destructive, checked, children, ...props }: ItemProps) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
				destructive && "text-destructive data-[highlighted]:bg-destructive/15 data-[highlighted]:text-destructive",
				className,
			)}
			{...props}
		>
			{checked !== undefined && (
				<span className="flex size-4 items-center justify-center">{checked && <Check className="size-3.5" />}</span>
			)}
			{children}
		</DropdownMenuPrimitive.Item>
	);
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
	return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
