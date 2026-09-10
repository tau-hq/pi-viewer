// Matches CSI/OSC escape sequences (same pattern family as the ansi-regex package).
const ANSI_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC, CSI and BEL delimit terminal escape sequences
	/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;

/** Remove ANSI escape codes (colors, cursor movement, OSC) from text produced for a terminal. */
export function stripAnsi(text: string): string {
	return text.replace(ANSI_PATTERN, "");
}
