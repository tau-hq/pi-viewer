import type { FileMatch } from "@pi-tau/shared";
import { ImagePlus, ListPlus, Send, Square, Zap } from "lucide-react";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { useSessionStore } from "@/store/session-store";
import { useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { IconButton } from "../ui/icon-button";
import { Kbd } from "../ui/kbd";
import { ImageChips } from "./ImageChips";
import { handleMentionKey, MentionMenu, useMentionMenu } from "./MentionMenu";
import { ModelPicker } from "./ModelPicker";
import { cycleApprovalMode, ModeMenu } from "./ModeMenu";
import { applyMention } from "./mentions";
import { SlashMenu, useSlashMenu } from "./SlashMenu";
import { parseSlash, type SlashItem } from "./slash-commands";
import { ThinkingPicker } from "./ThinkingPicker";
import { useComposerActions } from "./useComposerActions";
import { useImageAttachments } from "./useImageAttachments";

const MAX_ROWS = 10;
const LINE_HEIGHT_PX = 22;
const VERTICAL_PADDING_PX = 24;

/** Commands that run immediately when picked from the menu; the rest are inserted for arguments. */
const IMMEDIATE = new Set([
	"export",
	"jsonl",
	"fork",
	"clear-queue",
	"model",
	"thinking",
	"compact",
	"name",
	"tree",
	"clone",
	"tools",
	"commands",
	"copy",
	"session-settings",
	"import",
	"hotkeys",
	"changelog",
]);

// Editor requests stay in the session view; remember which one was applied so a remount keeps the draft.
const appliedEditorRequests = new Map<string, number>();
// Same for text a dialog put into the composer (the skills and prompts list).
const appliedInserts = new Map<string, number>();

export function Composer({ sessionId }: { sessionId: string }) {
	const running = useSessionStore((s) => {
		const view = s.views[sessionId];
		return !!view && (view.runActive || view.state.isStreaming);
	});
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	const editorRequest = useSessionStore((s) => s.views[sessionId]?.editorRequest);
	const composerInsert = useUiStore((s) => s.composerInsert);
	const connected = useConnectionStore((s) => s.status === "connected");
	const [value, setValue] = useState(() => useUiStore.getState().drafts[sessionId]?.text ?? "");
	const [caret, setCaret] = useState(0);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const valueRef = useRef(value);
	valueRef.current = value;
	// Caret to restore once React has written a programmatic value change to the DOM.
	const pendingCaret = useRef<number | undefined>(undefined);
	const attachments = useImageAttachments(useUiStore.getState().drafts[sessionId]?.images);
	const actions = useComposerActions(sessionId);
	const menu = useSlashMenu(value);
	// `/` at the start of the line stays command completion, so only one popup is ever open.
	const mentions = useMentionMenu(sessionId, value, caret, !menu.open);

	// Unsent text and images survive switching sessions.
	useEffect(() => {
		const empty = value.length === 0 && attachments.images.length === 0;
		useUiStore.getState().setDraft(sessionId, empty ? undefined : { text: value, images: attachments.images });
	}, [sessionId, value, attachments.images]);

	useEffect(() => {
		if (!editorRequest || appliedEditorRequests.get(sessionId) === editorRequest.nonce) return;
		appliedEditorRequests.set(sessionId, editorRequest.nonce);
		pendingCaret.current = editorRequest.text.length;
		setValue(editorRequest.text);
		textareaRef.current?.focus();
	}, [editorRequest, sessionId]);

	useEffect(() => {
		if (!composerInsert || composerInsert.sessionId !== sessionId) return;
		if (appliedInserts.get(sessionId) === composerInsert.nonce) return;
		appliedInserts.set(sessionId, composerInsert.nonce);
		// An append keeps an unsent draft and puts the text on a line of its own.
		const current = valueRef.current.replace(/\s+$/, "");
		const next = composerInsert.append && current ? `${current}\n${composerInsert.text}` : composerInsert.text;
		pendingCaret.current = next.length;
		setValue(next);
		textareaRef.current?.focus();
	}, [composerInsert, sessionId]);

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	// Auto-grow up to MAX_ROWS (an empty editor snaps back to a single line), then place a caret
	// a programmatic value change asked for, before the browser paints the new text.
	useLayoutEffect(() => {
		const el = textareaRef.current;
		if (!el) return;
		el.style.height = "auto";
		const max = MAX_ROWS * LINE_HEIGHT_PX + VERTICAL_PADDING_PX;
		el.style.height = value.length === 0 ? "" : `${Math.min(el.scrollHeight, max)}px`;
		if (pendingCaret.current === undefined) return;
		const position = Math.min(pendingCaret.current, value.length);
		pendingCaret.current = undefined;
		el.setSelectionRange(position, position);
		setCaret(position);
	}, [value]);

	/** Every caret move matters for `@` mentions: typing, clicking and arrow keys all sync it. */
	const syncCaret = () => setCaret(textareaRef.current?.selectionStart ?? 0);

	const hasContent = value.trim().length > 0 || attachments.images.length > 0;
	const canSend = connected && alive && hasContent;

	const reset = () => {
		setValue("");
		setCaret(0);
		attachments.clear();
	};

	const send = (followUp: boolean) => {
		if (!canSend) return;
		const text = value.trim();
		const slash = parseSlash(text);
		if (slash && actions.runSlash(slash.name, slash.args)) {
			reset();
			return;
		}
		// Unknown /commands go to pi as prompt text so extensions, prompts and skills resolve them.
		actions.submitPrompt(text, attachments.images, followUp);
		reset();
	};

	const pick = (item: SlashItem) => {
		if (item.source === "tau" && IMMEDIATE.has(item.name)) {
			actions.runSlash(item.name, "");
			reset();
		} else {
			pendingCaret.current = item.name.length + 2;
			setValue(`/${item.name} `);
		}
		textareaRef.current?.focus();
	};

	/** Insert the path only: the model reads the file itself, so no content is inlined. */
	const pickFile = (file: FileMatch) => {
		if (!mentions.mention) return;
		const next = applyMention(value, mentions.mention, file);
		pendingCaret.current = next.caret;
		setValue(next.text);
		textareaRef.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// Shift+Tab cycles the approval mode instead of moving focus out of the editor.
		if (event.key === "Tab" && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
			event.preventDefault();
			cycleApprovalMode();
			return;
		}
		if (handleMentionKey(event, mentions, pickFile)) return;
		if (menu.open) {
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				menu.move(event.key === "ArrowDown" ? 1 : -1);
				return;
			}
			if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && menu.items.length > 0) {
				event.preventDefault();
				const item = menu.items[menu.active];
				if (item) pick(item);
				return;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setValue("");
				return;
			}
		}
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			send(event.altKey);
			return;
		}
		if (event.key === "Escape" && running) {
			event.preventDefault();
			actions.abort();
		}
	};

	const placeholder = !connected
		? t("composer.offline")
		: running
			? t("composer.placeholderSteer")
			: t("composer.placeholder");

	return (
		<div className="relative" {...attachments.dragHandlers}>
			{menu.open ? (
				<SlashMenu menu={menu} onPick={pick} />
			) : (
				mentions.open && <MentionMenu menu={mentions} onPick={pickFile} />
			)}
			<div className="flex flex-col rounded-xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
				<ImageChips images={attachments.images} onRemove={attachments.remove} />
				<textarea
					ref={textareaRef}
					rows={1}
					value={value}
					onChange={(e) => {
						setValue(e.target.value);
						setCaret(e.target.selectionStart ?? e.target.value.length);
					}}
					onKeyDown={onKeyDown}
					onKeyUp={syncCaret}
					onClick={syncCaret}
					onSelect={syncCaret}
					onPaste={attachments.onPaste}
					placeholder={placeholder}
					disabled={!alive && connected}
					spellCheck
					className="max-h-64 min-h-[46px] w-full resize-none bg-transparent px-4 py-3 font-sans text-sm leading-[22px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
				/>
				<div data-testid="composer-tools" className="flex flex-wrap items-center gap-1 px-2 pb-2">
					<IconButton
						size="iconSm"
						label={t("composer.attach")}
						icon={<ImagePlus />}
						onClick={attachments.openPicker}
					/>
					<ModeMenu sessionId={sessionId} />
					<ModelPicker sessionId={sessionId} />
					<ThinkingPicker sessionId={sessionId} />
					<div className="flex-1" />
					{running && (
						<>
							<Button variant="ghost" size="sm" onClick={() => send(true)} disabled={!canSend}>
								<ListPlus />
								{t("composer.followUp")}
								<Kbd>Alt+↵</Kbd>
							</Button>
							<IconButton
								size="iconSm"
								variant="outline"
								label={t("composer.abort")}
								icon={<Square />}
								onClick={actions.abort}
								hint={<Kbd>Esc</Kbd>}
							/>
						</>
					)}
					<Button size="sm" onClick={() => send(false)} disabled={!canSend}>
						{running ? <Zap /> : <Send />}
						{running ? t("composer.steer") : t("composer.send")}
					</Button>
				</div>
			</div>
			{attachments.dragging && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl border-2 border-primary border-dashed bg-background/80 text-sm">
					{t("composer.dropImages")}
				</div>
			)}
		</div>
	);
}
