import { describe, expect, it } from "bun:test";
import { splitMessage } from "./reply-split.ts";

describe("splitMessage", () => {
	it("keeps short messages whole", () => {
		expect(splitMessage("oi")).toEqual(["oi"]);
	});

	it("splits on newlines within the limit", () => {
		const text = `${"a".repeat(1990)}\n${"b".repeat(50)}`;
		const chunks = splitMessage(text);
		expect(chunks).toHaveLength(2);
		expect(chunks.every((c) => c.length <= 2000)).toBe(true);
	});

	it("hard-cuts lines longer than the limit", () => {
		const chunks = splitMessage("x".repeat(4500));
		expect(chunks).toHaveLength(3);
		expect(chunks.join("")).toBe("x".repeat(4500));
	});

	it("mantem inteira a mensagem com exatamente o limite", () => {
		expect(splitMessage("a".repeat(2000))).toEqual(["a".repeat(2000)]);
	});

	it("consome a quebra de linha do corte: o pedaco seguinte nao comeca com \\n", () => {
		expect(splitMessage("aaa\nbbb", 5)).toEqual(["aaa", "bbb"]);
	});

	it("corta na ultima quebra de linha dentro do limite", () => {
		expect(splitMessage("aa\nbb\ncccc", 6)).toEqual(["aa\nbb", "cccc"]);
	});

	it("quebra no inicio do texto nao serve de corte: corta seco no limite", () => {
		expect(splitMessage("\nabcdef", 4)).toEqual(["\nabc", "def"]);
	});

	it("texto vazio vira um pedaco vazio", () => {
		expect(splitMessage("")).toEqual([""]);
	});

	it("nenhum pedaco passa do limite", () => {
		const text = Array.from({ length: 300 }, (_, i) => "palavra ".repeat(i % 40)).join("\n");
		expect(splitMessage(text, 100).every((c) => c.length <= 100)).toBe(true);
	});
});
