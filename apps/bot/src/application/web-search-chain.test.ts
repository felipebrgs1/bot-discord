import { describe, expect, it } from "bun:test";
import type { WebSearch } from "./ports/web-search.ts";
import { WebSearchChain } from "./web-search-chain.ts";

const answering = (text: string): WebSearch => ({ search: async () => text });
const failing = (message: string): WebSearch => ({
	search: async () => {
		throw new Error(message);
	},
});

describe("WebSearchChain", () => {
	it("usa o primeiro buscador que responde", async () => {
		const calls: string[] = [];
		const second: WebSearch = {
			search: async (q) => {
				calls.push(q);
				return "b";
			},
		};
		expect(await new WebSearchChain([answering("a"), second]).search("x", 5)).toBe("a");
		expect(calls).toEqual([]);
	});

	it("cai para o proximo quando um falha ou volta vazio", async () => {
		expect(await new WebSearchChain([failing("cota"), answering("  "), answering("c")]).search("x", 5)).toBe("c");
	});

	it("repassa query e maximo", async () => {
		const calls: [string, number][] = [];
		const spy: WebSearch = {
			search: async (q, max) => {
				calls.push([q, max]);
				return "ok";
			},
		};
		await new WebSearchChain([spy]).search("vasco", 3);
		expect(calls).toEqual([["vasco", 3]]);
	});

	it("todos vazios devolve vazio", async () => {
		expect(await new WebSearchChain([answering(""), answering("")]).search("x", 5)).toBe("");
	});

	it("todos falhando junta os erros", async () => {
		await expect(new WebSearchChain([failing("a caiu"), failing("b caiu")]).search("x", 5)).rejects.toThrow(
			"a caiu; b caiu",
		);
	});

	it("sem buscador configurado explica como configurar", async () => {
		await expect(new WebSearchChain([]).search("x", 5)).rejects.toThrow(
			"nenhum buscador configurado (TAVILY_API_KEY ou FIRECRAWL_API_KEY)",
		);
	});
});
