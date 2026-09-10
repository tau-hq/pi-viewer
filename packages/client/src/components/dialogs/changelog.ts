export interface ChangelogSlice {
	/** Markdown of the newest entries, everything above the first entry included. */
	markdown: string;
	shown: number;
	total: number;
}

/**
 * pi's changelog is half a megabyte, so only the newest releases are rendered. Releases are the
 * `## ` headings; fenced code blocks are skipped so a comment inside an example cannot count as one.
 */
export function sliceChangelog(markdown: string, maxEntries: number): ChangelogSlice {
	const lines = markdown.split("\n");
	const starts: number[] = [];
	let inFence = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence && line.startsWith("## ")) starts.push(index);
	}
	const total = starts.length;
	if (total <= maxEntries) return { markdown, shown: total, total };
	const cut = starts[maxEntries] ?? lines.length;
	return { markdown: `${lines.slice(0, cut).join("\n").replace(/\s+$/, "")}\n`, shown: maxEntries, total };
}
