import { describe, expect, it } from "bun:test";
import { filesText, isTextFile, MAX_TEXT_FILE_CHARS } from "./text-file.ts";

describe("isTextFile", () => {
	it("aceita text/* e extensoes de texto conhecidas", () => {
		expect(isTextFile("message.txt", "text/plain; charset=utf-8")).toBe(true);
		expect(isTextFile("notas.md", null)).toBe(true);
		expect(isTextFile("dados.CSV", undefined)).toBe(true);
		expect(isTextFile("config.json", "application/json")).toBe(true);
		expect(isTextFile("script.py", "application/octet-stream")).toBe(true);
	});

	it("recusa imagem, binario e arquivo sem extensao de texto", () => {
		expect(isTextFile("foto.png", "image/png")).toBe(false);
		expect(isTextFile("jogo.exe", "application/octet-stream")).toBe(false);
		expect(isTextFile("arquivo", null)).toBe(false);
	});
});

describe("filesText", () => {
	it("cada arquivo com o nome antes do conteudo", () => {
		expect(filesText([{ name: "message.txt", text: "qual alternativa?\n" }])).toBe("[arquivo message.txt]\nqual alternativa?");
	});

	it("corta arquivo longo e avisa", () => {
		const text = filesText([{ name: "a.txt", text: "x".repeat(MAX_TEXT_FILE_CHARS + 5) }]);
		expect(text).toBe(`[arquivo a.txt]\n${"x".repeat(MAX_TEXT_FILE_CHARS)}\n[... cortado]`);
	});
});
