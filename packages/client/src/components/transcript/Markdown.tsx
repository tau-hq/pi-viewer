import { memo } from "react";
import ReactMarkdown, { type Components, defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { PreBlock } from "./CodeBlock";

const remarkPlugins = [remarkGfm];

const shared: Components = {
	a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer noopener" />,
};

const finalComponents: Components = {
	...shared,
	pre: ({ node: _node, children }) => <PreBlock streaming={false}>{children}</PreBlock>,
};

const streamingComponents: Components = {
	...shared,
	pre: ({ node: _node, children }) => <PreBlock streaming>{children}</PreBlock>,
};

interface MarkdownProps {
	text: string;
	streaming?: boolean;
	className?: string;
}

export const Markdown = memo(function Markdown({ text, streaming = false, className }: MarkdownProps) {
	return (
		<div className={cn("md text-sm", className)}>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				components={streaming ? streamingComponents : finalComponents}
				urlTransform={defaultUrlTransform}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
});
