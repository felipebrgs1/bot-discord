import { describe, expect, it } from "bun:test";
import { formatIds, newSessionId, parseIds } from "./ids.ts";

describe("parseIds", () => {
	it("aceita linha, virgula e espaco; descarta vazios e repetidos", () => {
		expect(parseIds("111\n222, 333  111\n\n")).toEqual(["111", "222", "333"]);
	});

	it("formatIds poe um por linha", () => {
		expect(formatIds(["1", "2"])).toBe("1\n2");
	});
});

describe("newSessionId", () => {
	it("gera id aceito pelo servidor a partir da fonte de bytes", () => {
		const id = newSessionId((bytes) => bytes.fill(171));
		expect(id).toBe("sabababababababab");
		expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
	});
});
