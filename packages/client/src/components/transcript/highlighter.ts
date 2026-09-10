import type { HighlighterCore, LanguageRegistration } from "shiki/core";

const THEMES = { light: "github-light", dark: "github-dark-default" } as const;
const MAX_CODE_LENGTH = 60_000;
const MAX_CACHE = 300;

type LanguageLoader = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * Grammars are loaded on demand from shiki's fine-grained packages. Only this curated set ships
 * with the client (each entry is a lazy chunk); other languages fall back to plain text.
 */
const LANGUAGES: Record<string, LanguageLoader> = {
	bash: () => import("@shikijs/langs/bash"),
	c: () => import("@shikijs/langs/c"),
	cpp: () => import("@shikijs/langs/cpp"),
	csharp: () => import("@shikijs/langs/csharp"),
	css: () => import("@shikijs/langs/css"),
	diff: () => import("@shikijs/langs/diff"),
	docker: () => import("@shikijs/langs/docker"),
	go: () => import("@shikijs/langs/go"),
	graphql: () => import("@shikijs/langs/graphql"),
	html: () => import("@shikijs/langs/html"),
	ini: () => import("@shikijs/langs/ini"),
	java: () => import("@shikijs/langs/java"),
	javascript: () => import("@shikijs/langs/javascript"),
	json: () => import("@shikijs/langs/json"),
	jsx: () => import("@shikijs/langs/jsx"),
	kotlin: () => import("@shikijs/langs/kotlin"),
	lua: () => import("@shikijs/langs/lua"),
	makefile: () => import("@shikijs/langs/makefile"),
	markdown: () => import("@shikijs/langs/markdown"),
	php: () => import("@shikijs/langs/php"),
	python: () => import("@shikijs/langs/python"),
	ruby: () => import("@shikijs/langs/ruby"),
	rust: () => import("@shikijs/langs/rust"),
	scss: () => import("@shikijs/langs/scss"),
	sql: () => import("@shikijs/langs/sql"),
	swift: () => import("@shikijs/langs/swift"),
	toml: () => import("@shikijs/langs/toml"),
	tsx: () => import("@shikijs/langs/tsx"),
	typescript: () => import("@shikijs/langs/typescript"),
	xml: () => import("@shikijs/langs/xml"),
	yaml: () => import("@shikijs/langs/yaml"),
};

const ALIASES: Record<string, string> = {
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "bash",
	shellscript: "bash",
	yml: "yaml",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	py: "python",
	rb: "ruby",
	rs: "rust",
	md: "markdown",
	txt: "text",
	plaintext: "text",
	text: "text",
	jsonc: "json",
	json5: "json",
	"c++": "cpp",
	golang: "go",
	kt: "kotlin",
	yamlx: "yaml",
	dockerfile: "docker",
	cs: "csharp",
	svg: "xml",
	vue: "html",
	patch: "diff",
	make: "makefile",
	mk: "makefile",
	gql: "graphql",
};

export function normalizeLang(lang: string | undefined): string | undefined {
	if (!lang) return undefined;
	const lower = lang.trim().toLowerCase();
	const mapped = ALIASES[lower] ?? lower;
	return mapped === "text" ? undefined : mapped;
}

/** True when the client ships a grammar for the (normalized) language. */
export function isSupportedLang(lang: string): boolean {
	return Object.hasOwn(LANGUAGES, lang);
}

let highlighterPromise: Promise<HighlighterCore> | undefined;
const languageLoads = new Map<string, Promise<boolean>>();
const cache = new Map<string, string>();

async function loadHighlighter(): Promise<HighlighterCore> {
	if (!highlighterPromise) {
		highlighterPromise = (async () => {
			const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
				import("shiki/core"),
				import("shiki/engine/javascript"),
				import("@shikijs/themes/github-light"),
				import("@shikijs/themes/github-dark-default"),
			]);
			return createHighlighterCore({
				themes: [light.default, dark.default],
				langs: [],
				engine: createJavaScriptRegexEngine({ forgiving: true }),
			});
		})();
	}
	return highlighterPromise;
}

async function ensureLanguage(lang: string): Promise<boolean> {
	let pending = languageLoads.get(lang);
	if (!pending) {
		pending = (async () => {
			const loader = LANGUAGES[lang];
			if (!loader) return false;
			const [module, highlighter] = await Promise.all([loader(), loadHighlighter()]);
			await highlighter.loadLanguage(...module.default);
			return true;
		})();
		languageLoads.set(lang, pending);
	}
	return pending;
}

function remember(key: string, html: string): void {
	if (cache.size >= MAX_CACHE) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}
	cache.set(key, html);
}

/** Synchronous cache lookup so remounted rows render highlighted immediately. */
export function cachedHighlight(code: string, lang: string): string | undefined {
	return cache.get(`${lang} ${code}`);
}

/** Highlight with both themes as CSS variables; undefined when unsupported or too large. */
export async function highlightCode(code: string, lang: string): Promise<string | undefined> {
	if (code.length > MAX_CODE_LENGTH || !isSupportedLang(lang)) return undefined;
	const key = `${lang} ${code}`;
	const hit = cache.get(key);
	if (hit) return hit;
	try {
		if (!(await ensureLanguage(lang))) return undefined;
		const highlighter = await loadHighlighter();
		const html = highlighter.codeToHtml(code, { lang, themes: THEMES, defaultColor: false });
		remember(key, html);
		return html;
	} catch {
		return undefined;
	}
}
