import type { UserMessage as UserMessageType } from "@pi-tau/shared";
import { useMemo } from "react";
import { t } from "@/i18n";
import { imageDataUrl } from "@/lib/images";
import { blocksText, imageBlocks } from "@/lib/messages";

export function UserMessage({ message }: { message: UserMessageType }) {
	const text = blocksText(message.content);
	const images = useMemo(
		() => imageBlocks(message.content).map((image, index) => ({ key: `${message.id}-${index}`, image })),
		[message],
	);
	return (
		<div className="flex justify-end">
			<div className="max-w-[85%] rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-sm">
				{images.length > 0 && (
					<div className="mb-2 flex flex-wrap gap-2">
						{images.map(({ key, image }) => (
							<img key={key} src={imageDataUrl(image)} alt={t("transcript.imageAlt")} className="max-h-40 rounded-md" />
						))}
					</div>
				)}
				{text && <div className="whitespace-pre-wrap break-words">{text}</div>}
			</div>
		</div>
	);
}
