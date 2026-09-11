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
				{/* Deliberately not keyed by session: the terminal and the built transcripts survive a
				    switch. The parts that hold their own state are keyed inside the screen. */}
				{currentSessionId ? <SessionScreen sessionId={currentSessionId} /> : <EmptyState />}
			</main>
		</div>
	);
}
