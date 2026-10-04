import { describe, expect, it } from "bun:test";
import { FirecrawlSearch } from "./firecrawl-search.ts";

function recorder(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { calls, http };
}

const RESPONSE = {
	success: true,
	data: {
		web: [
			{ title: "Vasco", url: "https://pt.wikipedia.org/wiki/Vasco", description: "Clube brasileiro" },
			{ title: "Sem descricao", url: "https://x/y" },
		],
		news: [{ title: "Vasco vence", url: "https://ge/vasco", snippet: "Resumo do jogo", date: "2 horas atrás" }],
	},
};

describe("FirecrawlSearch", () => {
	it("posta a query com a chave, o maximo e as fontes web e news no Brasil", async () => {
		const { calls, http } = recorder(200, RESPONSE);
		await new FirecrawlSearch({ apiKey: "fc-k", http }).search("vasco", 3);
		expect(calls[0]?.url).toBe("https://api.firecrawl.dev/v2/search");
		expect(calls[0]?.init.method).toBe("POST");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer fc-k");
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body).toEqual({ query: "vasco", limit: 3, sources: ["web", "news"], country: "BR" });
	});

	it("formata noticias e resultados web com titulo, link, data e trecho", async () => {
		const { http } = recorder(200, RESPONSE);
		const text = await new FirecrawlSearch({ apiKey: "k", http }).search("vasco", 5);
		expect(text).toBe(
			[
				"Notícias:",
				"1. Vasco vence\n   Link: https://ge/vasco | 2 horas atrás\n   Resumo do jogo",
				"Web:",
				"1. Vasco\n   Link: https://pt.wikipedia.org/wiki/Vasco\n   Clube brasileiro",
				"2. Sem descricao\n   Link: https://x/y",
			].join("\n"),
		);
	});

	it("sem resultados devolve vazio", async () => {
		const { http } = recorder(200, { success: true, data: {} });
		expect(await new FirecrawlSearch({ apiKey: "k", http }).search("x", 5)).toBe("");
	});

	it("HTTP de erro vira excecao com o status", async () => {
		const { http } = recorder(402, { success: false, error: "sem creditos" });
		await expect(new FirecrawlSearch({ apiKey: "k", http }).search("x", 5)).rejects.toThrow("firecrawl HTTP 402");
	});
});
