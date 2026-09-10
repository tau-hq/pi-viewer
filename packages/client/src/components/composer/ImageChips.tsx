import type { ImageInput } from "@pi-tau/shared";
import { X } from "lucide-react";
import { t } from "@/i18n";
import { imageDataUrl } from "@/lib/images";

interface ImageChipsProps {
	images: ImageInput[];
	onRemove: (index: number) => void;
}

export function ImageChips({ images, onRemove }: ImageChipsProps) {
	if (images.length === 0) return null;
	const chips = images.map((image, index) => ({
		key: `${index}:${image.data.length}:${image.data.slice(-16)}`,
		image,
		index,
	}));
	return (
		<div className="flex flex-wrap gap-2 px-3 pt-3">
			{chips.map(({ key, image, index }) => (
				<div key={key} className="group relative size-16 overflow-hidden rounded-md border border-border">
					<img src={imageDataUrl(image)} alt={t("transcript.imageAlt")} className="size-full object-cover" />
					<button
						type="button"
						onClick={() => onRemove(index)}
						aria-label={t("composer.removeImage")}
						className="absolute top-0.5 right-0.5 rounded-full bg-background/80 p-0.5 text-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
					>
						<X className="size-3" />
					</button>
				</div>
			))}
		</div>
	);
}
