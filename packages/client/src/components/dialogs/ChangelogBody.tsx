import { useEffect, useState } from "react";
import { t } from "@/i18n";
import { asRecord, pickString } from "@/lib/result-data";
import { getTransport } from "@/transport/transport";
import { Markdown } from "../transcript/Markdown";
import { Spinner } from "../ui/spinner";
import { type ChangelogSlice, sliceChangelog } from "./changelog";

/** Enough to cover more than a year of pi releases without rendering the whole 550 kB file. */
const MAX_ENTRIES = 200;

interface Loaded {
	slice: ChangelogSlice;
	error: string | undefined;
}

/** Lazily imported: neither this component nor the fetched changelog belong in the eager bundle. */
export function ChangelogBody({ onVersion }: { onVersion: (version: string) => void }) {
	const [loaded, setLoaded] = useState<Loaded | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;
		getTransport()
			.send({ type: "pi.changelog" })
			.then((data) => {
				if (cancelled) return;
				const markdown = typeof asRecord(data)?.markdown === "string" ? String(asRecord(data)?.markdown) : "";
				const version = pickString(data, "version");
				if (version) onVersion(version);
				setLoaded({ slice: sliceChangelog(markdown, MAX_ENTRIES), error: undefined });
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					const message = error instanceof Error ? error.message : String(error);
					setLoaded({ slice: { markdown: "", shown: 0, total: 0 }, error: message });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [onVersion]);

	if (!loaded) {
		return (
			<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
				<Spinner /> {t("changelog.loading")}
			</div>
		);
	}
	if (loaded.error) {
		return <p className="p-6 text-center text-destructive text-sm">{loaded.error}</p>;
	}
	if (loaded.slice.total === 0 && loaded.slice.markdown.trim().length === 0) {
		return <p className="p-6 text-center text-muted-foreground text-sm">{t("changelog.empty")}</p>;
	}

	return (
		<>
			<div className="max-h-[60vh] overflow-y-auto rounded-md border border-border px-3 py-2">
				<Markdown text={loaded.slice.markdown} />
			</div>
			{loaded.slice.shown < loaded.slice.total && (
				<p data-testid="changelog-truncated" className="text-[11px] text-muted-foreground">
					{t("changelog.truncated", { shown: loaded.slice.shown, total: loaded.slice.total })}
				</p>
			)}
		</>
	);
}
