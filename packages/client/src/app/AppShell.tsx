import { ConnectionBanner } from "@/components/ConnectionBanner";
import { EmptyState } from "@/components/EmptyState";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { useCurrentSessionId } from "@/store/sessions-store";
import { SessionScreen } from "./SessionScreen";
import { useGlobalShortcuts } from "./useGlobalShortcuts";

export function AppShell() {
	const currentSessionId = useCurrentSessionId();
	useGlobalShortcuts();
	return (
		<div className="flex h-full w-full overflow-hidden bg-background text-foreground">
			<Sidebar />
			<main className="relative flex min-w-0 flex-1 flex-col">
				<ConnectionBanner />
				{currentSessionId ? <SessionScreen key={currentSessionId} sessionId={currentSessionId} /> : <EmptyState />}
			</main>
		</div>
	);
}
