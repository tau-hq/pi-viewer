import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
	/** Accessible name; also shown as tooltip. */
	label: string;
	icon: ReactNode;
	size?: "icon" | "iconSm";
	side?: "top" | "bottom" | "left" | "right";
	/** Extra tooltip content such as a keyboard hint. */
	hint?: ReactNode;
}

export function IconButton({ label, icon, size = "icon", variant = "ghost", side, hint, ...props }: IconButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button aria-label={label} size={size} variant={variant} {...props}>
					{icon}
				</Button>
			</TooltipTrigger>
			<TooltipContent {...(side ? { side } : {})}>
				<span className="inline-flex items-center gap-2">
					{label}
					{hint}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
