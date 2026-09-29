import { describe, expect, it } from "bun:test";
import { FakePageFetcher } from "../test-support/fakes/page-fetcher.ts";
import type { WebSearch } from "./ports/web-search.ts";
import { WebResearch } from "./web-research.ts";

function searcher(answer: (q: string, max: number) => Promise<string>) {
	const calls: [string, number][] = [];
	const fake: WebSearch = {
		search: (q, max) => {
			calls.push([q, max]);
			return answer(q, max);
		},
	};
	return { calls, fake };
}

describe("WebResearch.search", () => {
	it("repassa a query aparada com maximo entre 1 e 10 (padrao 5)", async () => {
		const { calls, fake } = searcher(async () => "achei");
		const research = new WebResearch(fake, new FakePageFetcher());
		expect(await research.search("  vasco  ")).toBe("achei");
		await research.search("x", 50);
		await research.search("x", 0);
		expect(calls).toEqual([
			["vasco", 5],
			["x", 10],
			["x", 1],
		]);
	});

	it("query vazia nao pesquisa", async () => {
		const { calls, fake } = searcher(async () => "x");
		expect(await new WebResearch(fake, new FakePageFetcher()).search("  ")).toBe("erro: query vazia");
		expect(calls).toEqual([]);
	});

	it("sem resultado avisa; erro vira texto", async () => {
		expect(await new WebResearch(searcher(async () => "  ").fake, new FakePageFetcher()).search("x")).toBe(
			"(sem resultados para essa busca)",
		);
		const failing = searcher(async () => {
			throw new Error("rede caiu");
		});
		expect(await new WebResearch(failing.fake, new FakePageFetcher()).search("x")).toBe("erro na pesquisa: rede caiu");
	});
});

describe("WebResearch.read", () => {
	const page =
		"<html><head><title>Matéria Boa</title><script>var x=1;</script></head><body><p>Primeiro parágrafo com conteúdo suficiente para passar do corte mínimo de caracteres aqui.</p><p>oi</p></body></html>";
	const research = (routes: ConstructorParameters<typeof FakePageFetcher>[0]) =>
		new WebResearch(searcher(async () => "").fake, new FakePageFetcher(routes));

	it("titulo + texto legivel, sem script", async () => {
		const text = await research([[/exemplo/, { body: page }]]).read("https://exemplo/materia");
		expect(text.startsWith("Título: Matéria Boa\n\n")).toBe(true);
		expect(text).toContain("Primeiro parágrafo");
		expect(text).not.toContain("var x=1");
	});

	it("corta no maximo pedido (1 a 20000, padrao 8000)", async () => {
		expect(await research([[/exemplo/, { body: page }]]).read("https://exemplo/materia", 10)).toBe("Título: Ma");
	});

	it("recusa URL nao-http sem rede", async () => {
		const r = research([]);
		expect(await r.read("ftp://x/y")).toBe("erro: URL inválida (use http/https)");
	});

	it("HTTP de erro, pagina sem texto e falha de rede viram erro legivel", async () => {
		expect(await research([[/x/, { status: 404, body: "" }]]).read("https://x/")).toBe("erro: HTTP 404");
		expect(await research([[/x/, { body: "<p>oi</p>" }]]).read("https://x/")).toBe("erro: página sem texto extraível");
		expect(await research([]).read("https://x/")).toBe("erro: rota não mockada: https://x/");
	});
});
