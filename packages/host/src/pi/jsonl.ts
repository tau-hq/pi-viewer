/**
 * Strict LF-delimited JSON lines, as pi's RPC mode emits them. Never use
 * readline here: it also splits on U+2028/U+2029, which are legal inside JSON strings.
 */
export class JsonLineSplitter {
	private buffer = "";

	/** Feed a chunk; returns the complete lines it produced (without the LF, trailing CR stripped). */
	push(chunk: string): string[] {
		this.buffer += chunk;
		const lines: string[] = [];
		let index = this.buffer.indexOf("\n");
		while (index !== -1) {
			let line = this.buffer.slice(0, index);
			this.buffer = this.buffer.slice(index + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.length > 0) lines.push(line);
			index = this.buffer.indexOf("\n");
		}
		return lines;
	}

	get pending(): string {
		return this.buffer;
	}
}
