import { en } from "./en";

type Leaves<T, P extends string = ""> = T extends string
	? P
	: { [K in keyof T & string]: Leaves<T[K], P extends "" ? K : `${P}.${K}`> }[keyof T & string];

/** Dotted key into the translation table, e.g. "sidebar.newSession". */
export type TKey = Leaves<typeof en>;

type Params = Record<string, string | number>;

const table: Record<string, unknown> = en;

function lookup(key: string): string {
	let node: unknown = table;
	for (const part of key.split(".")) {
		if (typeof node !== "object" || node === null) return key;
		node = (node as Record<string, unknown>)[part];
	}
	return typeof node === "string" ? node : key;
}

/** Resolve a user-facing string and fill `{placeholders}`. */
export function t(key: TKey, params?: Params): string {
	const text = lookup(key);
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}
