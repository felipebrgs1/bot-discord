import { describe, expect, it } from "bun:test";
import { TavilySearch } from "./tavily-search.ts";

function recorder(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { calls, http };
}

const RESPONSE = {
	answer: "O Vasco venceu por 2 a 1.",
	results: [
		{ title: "Vasco vence", url: "https://ge/vasco", content: "Resumo do jogo", published_date: "2026-09-08T10:00:00Z" },
		{ title: "Outra", url: "https://uol/outra", content: "Texto" },
	],
};

describe("TavilySearch", () => {
	it("posta a query com a chave e o maximo pedido", async () => {
		const { calls, http } = recorder(200, RESPONSE);
		await new TavilySearch({ apiKey: "tvly-k", http }).search("vasco", 3);
		expect(calls[0]?.url).toBe("https://api.tavily.com/search");
		expect(calls[0]?.init.method).toBe("POST");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer tvly-k");
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body).toMatchObject({ query: "vasco", max_results: 3, include_answer: true });
	});

	it("formata resposta direta e resultados com titulo, link, data e trecho", async () => {
		const { http } = recorder(200, RESPONSE);
		const text = await new TavilySearch({ apiKey: "k", http }).search("vasco", 5);
		expect(text).toBe(
			[
				"Resposta direta: O Vasco venceu por 2 a 1.",
				"1. Vasco vence\n   Link: https://ge/vasco | 2026-09-08T10:00:00Z\n   Resumo do jogo",
				"2. Outra\n   Link: https://uol/outra\n   Texto",
			].join("\n"),
		);
	});

	it("sem resultados devolve vazio", async () => {
		const { http } = recorder(200, { results: [] });
		expect(await new TavilySearch({ apiKey: "k", http }).search("x", 5)).toBe("");
	});

	it("HTTP de erro vira excecao com o status", async () => {
		const { http } = recorder(432, { detail: "limite" });
		await expect(new TavilySearch({ apiKey: "k", http }).search("x", 5)).rejects.toThrow("tavily HTTP 432");
	});
});
