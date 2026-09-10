import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { isActiveSummary } from "@/lib/session-match";
import { cn } from "@/lib/utils";
import type { SessionGroup } from "./grouping";
import { type SessionActions, SessionItem } from "./SessionItem";

interface ProjectGroupProps extends SessionActions {
	group: SessionGroup;
	currentSessionId: string | undefined;
	/** File of the shown session; it wins over the id after a clone or fork. */
	activeSessionFile: string | undefined;
}

export function ProjectGroup({ group, currentSessionId, activeSessionFile, ...actions }: ProjectGroupProps) {
	const [open, setOpen] = useState(true);
	return (
		<section className="mb-1" data-testid="project-group" data-project-cwd={group.cwd}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				title={group.cwd}
				className="flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left font-medium text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
			>
				<ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
				<span className="min-w-0 flex-1 truncate">{group.name}</span>
				<span className="text-[10px] tabular-nums">{group.sessions.length}</span>
			</button>
			{open && (
				<div className="flex flex-col gap-px">
					{group.sessions.map((session) => (
						<SessionItem
							key={session.path}
							session={session}
							active={isActiveSummary(session, currentSessionId, activeSessionFile)}
							{...actions}
						/>
					))}
				</div>
			)}
		</section>
	);
}
