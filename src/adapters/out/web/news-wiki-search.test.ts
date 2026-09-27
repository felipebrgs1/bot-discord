import { describe, expect, it } from "bun:test";
import { FakePageFetcher } from "../../../test-support/fakes/page-fetcher.ts";
import { NewsWikiSearch } from "./news-wiki-search.ts";

const RSS = `<?xml version="1.0"?>
<rss><channel>
<item><title><![CDATA[Vasco vence - ge.globo]]></title><link>https://exemplo/noticia</link><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Outro jogo - uol</title><link>https://exemplo/outra</link><pubDate>bad-date</pubDate></item>
</channel></rss>`;

describe("NewsWikiSearch", () => {
	it("formata RSS com fonte, data e link", async () => {
		const text = await new NewsWikiSearch(new FakePageFetcher([[/news\.google/, { body: RSS }]])).search("vasco", 5);
		expect(text).toContain("Notícias recentes:");
		expect(text).toContain("1. Vasco vence\n   Fonte: ge.globo | 08/09/2026");
		expect(text).toContain("Link: https://exemplo/noticia");
		expect(text).toContain("2. Outro jogo\n   Fonte: uol | bad-date");
	});

	it("respeita o maximo de itens", async () => {
		const text = await new NewsWikiSearch(new FakePageFetcher([[/news\.google/, { body: RSS }]])).search("vasco", 1);
		expect(text).not.toContain("Outro jogo");
	});

	it("RSS vazio cai para wiki + instant", async () => {
		const fetcher = new FakePageFetcher([
			[/news\.google/, { body: "<rss><channel></channel></rss>" }],
			[/wikipedia.*list=search/, { body: JSON.stringify({ query: { search: [{ title: "Vasco" }] } }) }],
			[
				/rest_v1\/page\/summary/,
				{
					body: JSON.stringify({
						title: "Vasco",
						extract: "Clube brasileiro",
						content_urls: { desktop: { page: "https://pt.wikipedia.org/wiki/Vasco" } },
					}),
				},
			],
			[/duckduckgo/, { body: JSON.stringify({ AbstractText: "resumo ddg", AbstractURL: "https://ddg", Answer: "42" }) }],
		]);
		const text = await new NewsWikiSearch(fetcher).search("vasco", 5);
		expect(text).toContain("Wikipedia — Vasco: Clube brasileiro");
		expect(text).toContain("Resumo: resumo ddg");
		expect(text).toContain("Resposta direta: 42");
	});

	it("wiki que falha nao impede o instant", async () => {
		const fetcher = new FakePageFetcher([
			[/news\.google/, { status: 500, body: "" }],
			[/wikipedia/, { status: 500, body: "" }],
			[/duckduckgo/, { body: JSON.stringify({ Answer: "42" }) }],
		]);
		expect(await new NewsWikiSearch(fetcher).search("x", 5)).toBe("Resposta direta: 42");
	});
});
