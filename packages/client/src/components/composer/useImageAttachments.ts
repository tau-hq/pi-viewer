import type { ImageInput } from "@pi-tau/shared";
import { type ClipboardEvent, type DragEvent, useCallback, useRef, useState } from "react";
import { t } from "@/i18n";
import { ImageError, MAX_IMAGE_MB, readImage } from "@/lib/images";
import { toast } from "@/store/ui-store";

export interface ImageAttachments {
	images: ImageInput[];
	dragging: boolean;
	addFiles: (files: Iterable<File>) => Promise<void>;
	remove: (index: number) => void;
	clear: () => void;
	openPicker: () => void;
	onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
	dragHandlers: {
		onDragOver: (event: DragEvent<HTMLElement>) => void;
		onDragLeave: (event: DragEvent<HTMLElement>) => void;
		onDrop: (event: DragEvent<HTMLElement>) => void;
	};
}

function hasFiles(event: DragEvent<HTMLElement>): boolean {
	return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/** Paste, drag-and-drop and file-picker images as base64 ImageInput chips. */
export function useImageAttachments(initial?: ImageInput[]): ImageAttachments {
	const [images, setImages] = useState<ImageInput[]>(() => initial ?? []);
	const [dragging, setDragging] = useState(false);
	const dragDepth = useRef(0);

	const addFiles = useCallback(async (files: Iterable<File>) => {
		for (const file of files) {
			try {
				const image = await readImage(file);
				setImages((current) => [...current, image]);
			} catch (error) {
				if (error instanceof ImageError) {
					toast(
						"warning",
						error.reason === "tooLarge" ? t("composer.imageTooLarge", { max: MAX_IMAGE_MB }) : t("composer.notImage"),
					);
				}
			}
		}
	}, []);

	const openPicker = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "image/*";
		input.multiple = true;
		input.onchange = () => {
			if (input.files) void addFiles(Array.from(input.files));
		};
		input.click();
	}, [addFiles]);

	const onPaste = useCallback(
		(event: ClipboardEvent<HTMLTextAreaElement>) => {
			const files = Array.from(event.clipboardData?.items ?? [])
				.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
				.map((item) => item.getAsFile())
				.filter((file): file is File => file !== null);
			if (files.length === 0) return;
			event.preventDefault();
			void addFiles(files);
		},
		[addFiles],
	);

	const dragHandlers = {
		onDragOver: (event: DragEvent<HTMLElement>) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			if (!dragging) setDragging(true);
		},
		onDragLeave: (event: DragEvent<HTMLElement>) => {
			if (!hasFiles(event)) return;
			dragDepth.current = Math.max(0, dragDepth.current - 1);
			if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
			setDragging(false);
		},
		onDrop: (event: DragEvent<HTMLElement>) => {
			if (!hasFiles(event)) return;
			event.preventDefault();
			setDragging(false);
			const files = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
			if (files.length > 0) void addFiles(files);
			else toast("warning", t("composer.notImage"));
		},
	};

	return {
		images,
		dragging,
		addFiles,
		remove: (index) => setImages((current) => current.filter((_, i) => i !== index)),
		clear: () => setImages([]),
		openPicker,
		onPaste,
		dragHandlers,
	};
}
