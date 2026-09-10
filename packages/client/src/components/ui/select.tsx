import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Native select, styled like the text input. A native control keeps the settings form small
 * and works with the keyboard and on touch without extra JavaScript.
 */
export function Select({ className, ...props }: ComponentProps<"select">) {
	return (
		<select
			className={cn(
				"h-8 min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}
