/** Parser message when `text` is not valid JSON, undefined when it parses. */
export function jsonSyntaxError(text: string): string | undefined {
	try {
		JSON.parse(text) as unknown;
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

export function isBlank(text: string): boolean {
	return text.trim().length === 0;
}
