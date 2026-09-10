import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
	return (
		<TabsPrimitive.List
			className={cn("inline-flex h-8 items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground", className)}
			{...props}
		/>
	);
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
	return (
		<TabsPrimitive.Trigger
			className={cn(
				"inline-flex h-7 items-center justify-center rounded-[5px] px-2.5 font-medium text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
				className,
			)}
			{...props}
		/>
	);
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
	return <TabsPrimitive.Content className={cn("mt-3 outline-none", className)} {...props} />;
}
