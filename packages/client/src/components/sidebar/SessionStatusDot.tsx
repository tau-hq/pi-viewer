import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SESSION_STATUS_LABEL, type SessionStatus } from "./session-status";

/**
 * The circle left of a session name, ~6px in every state so the row never moves.
 *
 * A filled dot carries weight and is spent only on states that ask something of the reader
 * (failed, waiting, unseen); the two calm states are rings, and only the two that are still
 * moving breathe. `--muted-foreground` and its 30% ring stay legible in both themes without
 * competing with the session name.
 */
const LOOK: Record<SessionStatus, string> = {
	error: "bg-destructive",
	needsInput: "animate-glow-slow bg-warning",
	working: "animate-glow border border-foreground",
	unseen: "bg-muted-foreground",
	seen: "border border-muted-foreground/30",
};

interface SessionStatusDotProps {
	status: SessionStatus;
	/** In the legend the state is spelled out next to the circle, so the circle stays silent. */
	decorative?: boolean;
	className?: string;
}

export function SessionStatusDot({ status, decorative = false, className }: SessionStatusDotProps) {
	const shape = cn("size-1.5 shrink-0 rounded-full", LOOK[status], className);
	if (decorative) return <span data-testid="session-status" data-status={status} aria-hidden className={shape} />;
	// Named for screen readers and on hover, so the circle never has to be guessed.
	const label = t(SESSION_STATUS_LABEL[status]);
	return (
		<span
			data-testid="session-status"
			data-status={status}
			role="img"
			aria-label={label}
			title={label}
			className={shape}
		/>
	);
}
