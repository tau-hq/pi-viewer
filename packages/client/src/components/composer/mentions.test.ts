import { describe, expect, it } from "vitest";
import { applyMention, findMention, mentionLabel } from "./mentions";

const file = (path: string) => ({ path, isDirectory: false });
const dir = (path: string) => ({ path, isDirectory: true });

describe("findMention", () => {
	it("takes everything between the @ and the next whitespace as the query", () => {
		expect(findMention("@prot", 5)).toEqual({ start: 0, end: 5, query: "prot" });
		expect(findMention("look at @src/app", 16)).toEqual({ start: 8, end: 16, query: "src/app" });
	});

	it("opens on a bare @ so the popup can list the top entries", () => {
		expect(findMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
		expect(findMention("read @ please", 6)).toEqual({ start: 5, end: 6, query: "" });
	});

	it("keeps the whole token when the caret sits inside it", () => {
		expect(findMention("@src/app more", 4)).toEqual({ start: 0, end: 8, query: "src/app" });
	});

	it("ignores an @ that is not at a word boundary", () => {
		expect(findMention("mail me@example.com", 19)).toBeUndefined();
		expect(findMention("a@b", 3)).toBeUndefined();
	});

	it("is undefined without an @ before the caret, and after the token ended", () => {
		expect(findMention("plain text", 5)).toBeUndefined();
		expect(findMention("", 0)).toBeUndefined();
		// The caret sits behind the space that closed the mention.
		expect(findMention("@src/app.ts ", 12)).toBeUndefined();
		// The caret is before the @, so nothing is being completed.
		expect(findMention("@src", 0)).toBeUndefined();
	});

	it("clamps a caret outside the text", () => {
		expect(findMention("@src", 99)).toEqual({ start: 0, end: 4, query: "src" });
		expect(findMention("@src", -3)).toBeUndefined();
	});

	it("takes the last @ of several", () => {
		expect(findMention("@a.ts @b", 8)).toEqual({ start: 6, end: 8, query: "b" });
	});
});

describe("applyMention", () => {
	it("replaces the token with the path and a trailing space", () => {
		const mention = findMention("@prot", 5);
		expect(mention && applyMention("@prot", mention, file("packages/shared/src/protocol.ts"))).toEqual({
			text: "@packages/shared/src/protocol.ts ",
			caret: 33,
			keepOpen: false,
		});
	});

	it("keeps the surrounding text, swallows the following space and moves the caret behind it", () => {
		const text = "compare @cli with the host";
		const mention = findMention(text, 12);
		expect(mention && applyMention(text, mention, file("src/cli.ts"))).toEqual({
			text: "compare @src/cli.ts with the host",
			caret: 20,
			keepOpen: false,
		});
	});

	it("leaves a directory open for drilling down", () => {
		const mention = findMention("@client", 7);
		expect(mention && applyMention("@client", mention, dir("packages/client/"))).toEqual({
			text: "@packages/client/",
			caret: 17,
			keepOpen: true,
		});
	});

	it("adds the missing separator of a directory match", () => {
		const mention = findMention("@e2e", 4);
		expect(mention && applyMention("@e2e", mention, dir("e2e"))).toMatchObject({ text: "@e2e/", keepOpen: true });
	});
});

describe("mentionLabel", () => {
	it("splits a path into its name and the directory in front of it", () => {
		expect(mentionLabel("packages/shared/src/protocol.ts")).toEqual({
			dir: "packages/shared/src/",
			name: "protocol.ts",
		});
		expect(mentionLabel("README.md")).toEqual({ dir: "", name: "README.md" });
	});

	it("keeps the trailing slash of a directory on its name", () => {
		expect(mentionLabel("packages/client/")).toEqual({ dir: "packages/", name: "client/" });
		expect(mentionLabel("e2e/")).toEqual({ dir: "", name: "e2e/" });
	});
});
