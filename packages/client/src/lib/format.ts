import { t } from "@/i18n";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time such as "now", "5m", "3h", "2d" or a short date beyond a week. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
	const diff = Math.max(0, now - timestamp);
	if (diff < MINUTE) return t("time.now");
	if (diff < HOUR) return t("time.minutes", { n: Math.floor(diff / MINUTE) });
	if (diff < DAY) return t("time.hours", { n: Math.floor(diff / HOUR) });
	if (diff < 7 * DAY) return t("time.days", { n: Math.floor(diff / DAY) });
	return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** 1234 -> "1.2k", 1234567 -> "1.2M". */
export function formatTokens(count: number): string {
	if (!Number.isFinite(count)) return "0";
	if (count < 1000) return String(Math.round(count));
	if (count < 1_000_000) return `${trimZero((count / 1000).toFixed(1))}k`;
	return `${trimZero((count / 1_000_000).toFixed(2))}M`;
}

function trimZero(value: string): string {
	return value.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

/** USD with adaptive precision. */
export function formatCost(usd: number): string {
	if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
	if (usd < 0.01) return `$${usd.toFixed(4)}`;
	if (usd < 1) return `$${usd.toFixed(3)}`;
	return `$${usd.toFixed(2)}`;
}

export function formatPercent(percent: number | null | undefined): string {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) return "–";
	return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** Replace the home directory prefix with "~". */
export function shortenPath(path: string, home?: string): string {
	if (home && home.length > 1 && (path === home || path.startsWith(`${home}/`))) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

export function basename(path: string): string {
	const trimmed = path.replace(/[/\\]+$/, "");
	const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	return index >= 0 ? trimmed.slice(index + 1) : trimmed;
}
