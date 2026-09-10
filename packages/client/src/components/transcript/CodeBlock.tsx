import { Check, Copy } from "lucide-react";
import { Children, isValidElement, type ReactNode, useEffect, useState } from "react";
import { t } from "@/i18n";
import { copyText } from "@/lib/download";
import { cachedHighlight, highlightCode, normalizeLang } from "./highlighter";

interface CodeBlockProps {
	code: string;
	lang: string | undefined;
	/** While streaming the block is rendered as plain text; highlighting starts once finished. */
	streaming: boolean;
}

function CopyButton({ text, className }: { text: string; className?: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			onClick={() => void copyText(text).then((ok) => ok && setCopied(true))}
			aria-label={copied ? t("transcript.copied") : t("transcript.copy")}
			className={className ?? "flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground"}
		>
			{copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
			<span>{copied ? t("transcript.copied") : t("transcript.copy")}</span>
		</button>
	);
}

export function CodeBlock({ code, lang, streaming }: CodeBlockProps) {
	const normalized = normalizeLang(lang);
	const [html, setHtml] = useState<string | undefined>(() =>
		!streaming && normalized ? cachedHighlight(code, normalized) : undefined,
	);

	useEffect(() => {
		if (streaming || !normalized) return;
		let cancelled = false;
		void highlightCode(code, normalized).then((result) => {
			if (!cancelled && result) setHtml(result);
		});
		return () => {
			cancelled = true;
		};
	}, [code, normalized, streaming]);

	return (
		<div className="code-block my-2 overflow-hidden rounded-lg border border-border bg-card">
			<div className="flex h-7 items-center justify-between border-border border-b px-2.5 text-[11px] text-muted-foreground">
				<span className="font-mono">{lang ?? "text"}</span>
				<CopyButton text={code} />
			</div>
			{html && !streaming ? (
				// biome-ignore lint/security/noDangerouslySetInnerHtml: shiki escapes the code; markup is generated locally
				<div dangerouslySetInnerHTML={{ __html: html }} />
			) : (
				<pre>
					<code>{code}</code>
				</pre>
			)}
		</div>
	);
}

function textOf(node: ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
	return "";
}

/** react-markdown renders fenced code as <pre><code class="language-x">; unwrap it into CodeBlock. */
export function PreBlock({ children, streaming }: { children?: ReactNode; streaming: boolean }) {
	const child = Children.toArray(children)[0];
	if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
		const lang = /language-([\w+#.-]+)/.exec(child.props.className ?? "")?.[1];
		const code = textOf(child.props.children).replace(/\n$/, "");
		return <CodeBlock code={code} lang={lang} streaming={streaming} />;
	}
	return <pre>{children}</pre>;
}
