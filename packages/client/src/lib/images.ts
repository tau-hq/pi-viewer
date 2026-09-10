import type { ImageInput } from "@pi-tau/shared";

export const MAX_IMAGE_MB = 10;

export class ImageError extends Error {
	constructor(
		readonly reason: "notImage" | "tooLarge",
		message: string,
	) {
		super(message);
	}
}

/** Read a File/Blob into the base64 shape the protocol expects (no data: prefix). */
export function readImage(file: Blob): Promise<ImageInput> {
	if (!file.type.startsWith("image/")) {
		return Promise.reject(new ImageError("notImage", file.type));
	}
	if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
		return Promise.reject(new ImageError("tooLarge", String(file.size)));
	}
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.onload = () => {
			const result = typeof reader.result === "string" ? reader.result : "";
			const comma = result.indexOf(",");
			resolve({ mimeType: file.type, data: comma >= 0 ? result.slice(comma + 1) : result });
		};
		reader.readAsDataURL(file);
	});
}

export function imageDataUrl(image: { mimeType: string; data: string }): string {
	return `data:${image.mimeType};base64,${image.data}`;
}
