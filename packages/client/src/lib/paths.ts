/** Path helpers for host file systems; the separator comes from HostInfo.platform. */

export function separatorFor(platform: string | undefined): string {
	return platform?.startsWith("win") ? "\\" : "/";
}

export function joinPath(base: string, name: string, sep: string): string {
	if (base.endsWith(sep)) return `${base}${name}`;
	return `${base}${sep}${name}`;
}

/** Parent directory, or undefined at the root ("/" or "C:\"). */
export function parentPath(path: string, sep: string): string | undefined {
	const trimmed = path.length > 1 && path.endsWith(sep) ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf(sep);
	if (index < 0) return undefined;
	if (index === 0) return trimmed.length > 1 ? sep : undefined;
	const parent = trimmed.slice(0, index);
	// "C:" -> "C:\"
	return /^[A-Za-z]:$/.test(parent) ? `${parent}${sep}` : parent;
}

export interface Crumb {
	label: string;
	path: string;
}

/** Breadcrumb entries from the root down to `path`. */
export function pathCrumbs(path: string, sep: string): Crumb[] {
	const parts = path.split(sep).filter((part) => part.length > 0);
	const crumbs: Crumb[] = [];
	if (path.startsWith(sep)) {
		crumbs.push({ label: sep, path: sep });
	} else if (parts.length > 0 && /^[A-Za-z]:$/.test(parts[0] ?? "")) {
		const drive = parts.shift() ?? "";
		crumbs.push({ label: `${drive}${sep}`, path: `${drive}${sep}` });
	}
	let current = crumbs[0]?.path ?? "";
	for (const part of parts) {
		current = current ? joinPath(current, part, sep) : part;
		crumbs.push({ label: part, path: current });
	}
	return crumbs;
}
