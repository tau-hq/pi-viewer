import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;

interface DialogContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
	hideClose?: boolean;
	size?: "sm" | "md" | "lg";
}

const sizes = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function DialogContent({ className, children, hideClose, size = "md", ...props }: DialogContentProps) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Overlay className="data-[state=open]:fade-in-0 data-[state=open]:animate-in fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" />
			<DialogPrimitive.Content
				className={cn(
					"data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl outline-none",
					sizes[size],
					className,
				)}
				{...props}
			>
				{children}
				{!hideClose && (
					<DialogPrimitive.Close
						className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
						aria-label={t("ui.close")}
					>
						<X className="size-4" />
					</DialogPrimitive.Close>
				)}
			</DialogPrimitive.Content>
		</DialogPrimitive.Portal>
	);
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex flex-col gap-1 pr-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn("flex items-center justify-end gap-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
	return <DialogPrimitive.Title className={cn("font-semibold text-base leading-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
	return <DialogPrimitive.Description className={cn("text-muted-foreground text-sm", className)} {...props} />;
}
