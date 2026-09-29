import { describe, expect, it } from "bun:test";
import type { MemoryItem } from "@elmatadore/api";
import { filterMemories, kindCounts } from "./memories.ts";

const m = (id: number, kind: string, content: string, extra: Partial<MemoryItem> = {}): MemoryItem => ({
	id,
	channel_id: "c1",
	scope: "group",
	key: `k${id}`,
	kind,
	status: "active",
	content,
	version: 1,
	updated_at: "2026-09-29T12:00:00.000Z",
	...extra,
});

describe("filterMemories", () => {
	const items = [m(1, "fact", "gosta de Terraria"), m(2, "preference", "odeia spoiler", { scope: "user", user_id: "u42" }), m(3, "fact", "server BR")];

	it("filtra por tipo", () => {
		expect(filterMemories(items, { kind: "fact", query: "" }).map((x) => x.id)).toEqual([1, 3]);
	});

	it("busca no conteudo, na chave e na pessoa, sem caixa", () => {
		expect(filterMemories(items, { kind: "all", query: "TERRARIA" }).map((x) => x.id)).toEqual([1]);
		expect(filterMemories(items, { kind: "all", query: "k3" }).map((x) => x.id)).toEqual([3]);
		expect(filterMemories(items, { kind: "all", query: "u42" }).map((x) => x.id)).toEqual([2]);
	});
});

describe("kindCounts", () => {
	it("conta por tipo, maior primeiro", () => {
		expect(kindCounts([m(1, "fact", ""), m(2, "lesson", ""), m(3, "fact", "")])).toEqual([
			["fact", 2],
			["lesson", 1],
		]);
	});
});
