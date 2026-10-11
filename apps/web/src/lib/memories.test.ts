import { describe, expect, it } from "bun:test";
import type { MemoryBlock } from "@elmatadore/api";
import { draftSize, entriesFromText, filterBlocks, usageLevel } from "./memories.ts";

const block = (owner_id: string, name: string, entries: string[], scope: MemoryBlock["scope"] = "user"): MemoryBlock => ({
	scope,
	owner_id,
	name,
	entries,
	size: 0,
	limit: 100,
	updated_at: "2026-10-11T12:00:00.000Z",
});

describe("filterBlocks", () => {
	const blocks = [block("c1", "c1", ["sextou é sagrado"], "group"), block("u1", "Ana", ["odeia spoiler"]), block("u2", "Bruno", ["joga LoL"])];

	it("sem busca devolve tudo", () => {
		expect(filterBlocks(blocks, " ").map((b) => b.owner_id)).toEqual(["c1", "u1", "u2"]);
	});

	it("busca no nome, no id e nas entradas, sem caixa", () => {
		expect(filterBlocks(blocks, "ana").map((b) => b.owner_id)).toEqual(["u1"]);
		expect(filterBlocks(blocks, "U2").map((b) => b.owner_id)).toEqual(["u2"]);
		expect(filterBlocks(blocks, "SPOILER").map((b) => b.owner_id)).toEqual(["u1"]);
	});
});

describe("entriesFromText", () => {
	it("uma entrada por linha, sem linha vazia nem espaco nas pontas", () => {
		expect(entriesFromText("  joga LoL \n\n odeia spoiler\n")).toEqual(["joga LoL", "odeia spoiler"]);
	});
});

describe("draftSize", () => {
	it("conta como o bot: entradas mais uma quebra entre elas", () => {
		expect(draftSize([])).toBe(0);
		expect(draftSize(["abc", "de"])).toBe(6);
	});
});

describe("usageLevel", () => {
	it("ok ate 80%, cheio acima disso, estourado passando do teto", () => {
		expect(usageLevel(80, 100)).toBe("ok");
		expect(usageLevel(81, 100)).toBe("high");
		expect(usageLevel(101, 100)).toBe("over");
	});
});
