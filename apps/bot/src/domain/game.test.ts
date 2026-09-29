import { describe, expect, it } from "bun:test";
import { formatGameList, normalizeGameName } from "./game.ts";

describe("normalizeGameName", () => {
	it("apara e colapsa espacos", () => {
		expect(normalizeGameName("  elden   ring  ")).toBe("elden ring");
	});
});

describe("formatGameList", () => {
	const hits = [
		{ title: "The Sims 4", url: "https://s/4" },
		{ title: "The Sims 3", url: "https://s/3" },
	];

	it("numera titulo e link", () => {
		expect(formatGameList(hits, "https://busca")).toBe("1. The Sims 4\nhttps://s/4\n2. The Sims 3\nhttps://s/3");
	});

	it("sem resultado devolve o link da busca", () => {
		expect(formatGameList([], "https://busca?s=zzz")).toBe("(nada encontrado; busca: https://busca?s=zzz)");
	});
});
