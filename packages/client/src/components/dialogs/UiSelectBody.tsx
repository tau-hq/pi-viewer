import type { UiResponse, UiSelectRequest } from "@pi-tau/shared";
import { type KeyboardEvent, useMemo, useState } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { type ApprovalShortcuts, type ShortcutKey, shortcutFor } from "./approval";

export type Answer = (response: UiResponse) => void;

interface UiSelectBodyProps {
	request: UiSelectRequest;
	answer: Answer;
	/** Present for tool approvals: single-key answers and hints next to the options. */
	shortcuts?: ApprovalShortcuts;
}

function isTextField(target: EventTarget | null): boolean {
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Option list of a `select` request: arrow keys + Enter, optional filter, approval shortcuts. */
export function UiSelectBody({ request, answer, shortcuts }: UiSelectBodyProps) {
	const [filter, setFilter] = useState("");
	const [active, setActive] = useState(0);
	const options = useMemo(() => {
		const q = filter.trim().toLowerCase();
		return q ? request.options.filter((option) => option.toLowerCase().includes(q)) : request.options;
	}, [request.options, filter]);

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActive((i) => Math.min(options.length - 1, i + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setActive((i) => Math.max(0, i - 1));
		} else if (event.key === "Enter") {
			event.preventDefault();
			const option = options[active];
			if (option !== undefined) answer({ id: request.id, value: option });
		} else if (shortcuts && !event.ctrlKey && !event.metaKey && !event.altKey && !isTextField(event.target)) {
			const key = event.key.toLowerCase();
			if (key !== "a" && key !== "s" && key !== "d") return;
			event.preventDefault();
			const option = shortcuts[key];
			if (option !== undefined) answer({ id: request.id, value: option });
			else if (key === "d") answer({ id: request.id, cancelled: true });
		}
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: key events bubble here from the option buttons and the filter field
		<div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
			{request.options.length > 8 && (
				<Input
					value={filter}
					onChange={(e) => {
						setFilter(e.target.value);
						setActive(0);
					}}
					placeholder={t("sidebar.search")}
				/>
			)}
			<ul className="max-h-72 overflow-y-auto rounded-md border border-border p-1">
				{options.map((option, index) => {
					const key: ShortcutKey | undefined = shortcuts ? shortcutFor(option, shortcuts) : undefined;
					return (
						<li key={option}>
							<button
								type="button"
								onMouseEnter={() => setActive(index)}
								onClick={() => answer({ id: request.id, value: option })}
								className={cn(
									"flex w-full items-center gap-3 rounded px-2.5 py-1.5 text-left text-sm outline-none",
									index === active && "bg-accent text-accent-foreground",
								)}
							>
								<span className="min-w-0 flex-1">{option}</span>
								{key && <Kbd>{key.toUpperCase()}</Kbd>}
							</button>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
