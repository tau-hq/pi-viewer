import type { ITheme } from "@xterm/xterm";

/**
 * xterm.js theme built from the Tau design tokens, so the terminal follows light and dark mode.
 *
 * The tokens are OKLCH, which xterm's own color parser does not read, so every value goes
 * through a canvas 2d context: assigning `fillStyle` normalizes any color the browser
 * understands to `#rrggbb` and leaves the previous value in place for an invalid one.
 */

let ctx: CanvasRenderingContext2D | null | undefined;

function context(): CanvasRenderingContext2D | null {
	if (ctx === undefined) {
		ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	}
	return ctx;
}

function channel(value: number | undefined): string {
	return (value ?? 0).toString(16).padStart(2, "0");
}

/**
 * Normalize a CSS color to `#rrggbb`; unparsable values fall back.
 *
 * Chrome serializes `fillStyle` for wide-gamut colors back as the OKLCH string it was given,
 * and xterm's own parser reads neither that nor `color-mix()` — it would silently paint black.
 * Rasterizing one pixel and reading it back yields the sRGB bytes xterm needs.
 */
function toHexColor(value: string, fallback: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) return fallback;
	const target = context();
	if (!target) return fallback;
	// An invalid value leaves fillStyle at the sentinel, so two different sentinels detect it.
	target.fillStyle = "#000000";
	target.fillStyle = trimmed;
	const first = String(target.fillStyle);
	target.fillStyle = "#ffffff";
	target.fillStyle = trimmed;
	if (first !== String(target.fillStyle)) return fallback;
	try {
		target.clearRect(0, 0, 1, 1);
		target.fillRect(0, 0, 1, 1);
		const [r, g, b] = target.getImageData(0, 0, 1, 1).data;
		return `#${channel(r)}${channel(g)}${channel(b)}`;
	} catch {
		return fallback;
	}
}

function withAlpha(hex: string, alpha: number): string {
	const match = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!match?.[1]) return hex;
	const value = Number.parseInt(match[1], 16);
	return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const ANSI: readonly (readonly [keyof ITheme, string, string])[] = [
	["black", "--term-black", "#4d4d4d"],
	["red", "--term-red", "#c14a4a"],
	["green", "--term-green", "#3f8f5e"],
	["yellow", "--term-yellow", "#a07d20"],
	["blue", "--term-blue", "#4a6dc1"],
	["magenta", "--term-magenta", "#9a4ac1"],
	["cyan", "--term-cyan", "#2f7f8f"],
	["white", "--term-white", "#b0b0b0"],
	["brightBlack", "--term-bright-black", "#7a7a7a"],
	["brightRed", "--term-bright-red", "#e06c6c"],
	["brightGreen", "--term-bright-green", "#5cbd82"],
	["brightYellow", "--term-bright-yellow", "#d5b040"],
	["brightBlue", "--term-bright-blue", "#7f9be6"],
	["brightMagenta", "--term-bright-magenta", "#c07ce6"],
	["brightCyan", "--term-bright-cyan", "#6fc2d0"],
	["brightWhite", "--term-bright-white", "#f2f2f2"],
];

export function buildXtermTheme(root: HTMLElement = document.documentElement): ITheme {
	const style = getComputedStyle(root);
	const read = (name: string, fallback: string) => toHexColor(style.getPropertyValue(name), fallback);
	const background = read("--term-background", "#111111");
	const foreground = read("--term-foreground", "#e6e6e6");
	const cursor = read("--term-cursor", foreground);
	const theme: ITheme = {
		background,
		foreground,
		cursor,
		cursorAccent: background,
		selectionBackground: withAlpha(cursor, 0.35),
		selectionInactiveBackground: withAlpha(cursor, 0.2),
		scrollbarSliderBackground: withAlpha(foreground, 0.16),
		scrollbarSliderHoverBackground: withAlpha(foreground, 0.28),
		scrollbarSliderActiveBackground: withAlpha(foreground, 0.4),
	};
	for (const [key, variable, fallback] of ANSI) {
		Object.assign(theme, { [key]: read(variable, fallback) });
	}
	return theme;
}
