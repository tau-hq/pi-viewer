import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { type Toast, useUiStore } from "@/store/ui-store";

const AUTO_DISMISS_MS: Record<Toast["level"], number | undefined> = { info: 5000, warning: 8000, error: undefined };

function ToastItem({ toast }: { toast: Toast }) {
	const dismiss = useUiStore((s) => s.dismissToast);
	useEffect(() => {
		const ttl = AUTO_DISMISS_MS[toast.level];
		if (ttl === undefined) return;
		const timer = setTimeout(() => dismiss(toast.id), ttl);
		return () => clearTimeout(timer);
	}, [toast.id, toast.level, dismiss]);

	const Icon = toast.level === "error" ? CircleAlert : toast.level === "warning" ? TriangleAlert : Info;
	return (
		<output
			className={cn(
				"pointer-events-auto flex w-80 animate-in items-start gap-2.5 rounded-lg border bg-popover px-3 py-2.5 text-popover-foreground text-sm shadow-lg",
				toast.level === "error" && "border-destructive/40",
				toast.level === "warning" && "border-warning/40",
				toast.level === "info" && "border-border",
			)}
		>
			<Icon
				className={cn(
					"mt-0.5 size-4 shrink-0",
					toast.level === "error" && "text-destructive",
					toast.level === "warning" && "text-warning",
					toast.level === "info" && "text-primary",
				)}
			/>
			<span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{toast.message}</span>
			<button
				type="button"
				onClick={() => dismiss(toast.id)}
				aria-label={t("toast.dismiss")}
				className="-m-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				<X className="size-3.5" />
			</button>
		</output>
	);
}

export function Toaster() {
	const toasts = useUiStore((s) => s.toasts);
	if (toasts.length === 0) return null;
	return (
		<section
			aria-label={t("toast.notifications")}
			className="pointer-events-none fixed top-3 right-3 z-[60] flex flex-col gap-2"
		>
			{toasts.map((toast) => (
				<ToastItem key={toast.id} toast={toast} />
			))}
		</section>
	);
}
