import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 font-medium text-[11px] leading-4 [&_svg]:size-3",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary/15 text-primary",
				secondary: "border-transparent bg-secondary text-secondary-foreground",
				outline: "border-border text-muted-foreground",
				success: "border-transparent bg-success/15 text-success",
				warning: "border-transparent bg-warning/15 text-warning",
				destructive: "border-transparent bg-destructive/15 text-destructive",
			},
		},
		defaultVariants: { variant: "default" },
	},
);

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
	return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
