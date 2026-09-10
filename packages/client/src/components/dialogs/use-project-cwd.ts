import { useConnectionStore } from "@/store/connection-store";
import { useSessionStore } from "@/store/session-store";
import { useCurrentSessionId } from "@/store/sessions-store";

/**
 * Directory a project scoped read/write applies to: the shown session's working directory,
 * else the host's default. Undefined only while the host is unknown.
 */
export function useProjectCwd(): string | undefined {
	const sessionId = useCurrentSessionId();
	const sessionCwd = useSessionStore((s) => (sessionId ? s.views[sessionId]?.state.cwd : undefined));
	const defaultCwd = useConnectionStore((s) => s.host?.defaultCwd);
	return sessionCwd || defaultCwd;
}

/** Message of a thrown value, for inline error lines. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
