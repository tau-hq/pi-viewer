import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
	return <LoaderCircle aria-hidden className={cn("size-4 animate-spin text-muted-foreground", className)} />;
}

/** Three pulsing dots, used while an assistant block is still streaming. */
export function PulsingDots({ className }: { className?: string }) {
	return (
		<span aria-hidden className={cn("inline-flex items-center gap-0.5", className)}>
			<span className="size-1 animate-pulse-dot rounded-full bg-current" />
			<span className="size-1 animate-pulse-dot rounded-full bg-current [animation-delay:150ms]" />
			<span className="size-1 animate-pulse-dot rounded-full bg-current [animation-delay:300ms]" />
		</span>
	);
}
