import { describe, expect, it } from "bun:test";
import { FakePageFetcher } from "../../../test-support/fakes/page-fetcher.ts";
import { parseMagnet, parseSkidrowTop, SkidrowCatalog, skidrowSearchUrl } from "./skidrow-catalog.ts";

const SKIDROW_HTML = `<html><body>
<h2>3 search results for "the sims"</h2>
<img decoding="async" class="aligncenter" src="https://www.skidrowreloaded.com/wp-content/uploads/sims4.jpg" alt="The Sims 4 v1.2.3" />
<h2><a href="https://www.skidrowreloaded.com/the-sims-4-v1-2-3/">The Sims 4 v1.2.3</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-3-v4-5-6/">The Sims 3 v4.5.6</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-2-v7-8-9/">The Sims 2 v7.8.9</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-1-v0-1/">The Sims 1 v0.1</a></h2>
</body></html>`;

describe("skidrowSearchUrl", () => {
	it("espaco vira +, normaliza e recusa vazio", () => {
		expect(skidrowSearchUrl("the sims")).toBe("https://www.skidrowreloaded.com/?s=the+sims&x=15&y=25");
		expect(skidrowSearchUrl("  elden   ring  ")).toBe("https://www.skidrowreloaded.com/?s=elden+ring&x=15&y=25");
		expect(() => skidrowSearchUrl("   ")).toThrow();
	});
});

describe("parseSkidrowTop", () => {
	it("so h2 com link, top 3, capa pelo alt", () => {
		const hits = parseSkidrowTop(SKIDROW_HTML);
		expect(hits).toHaveLength(3);
		expect(hits[0]).toEqual({
			title: "The Sims 4 v1.2.3",
			url: "https://www.skidrowreloaded.com/the-sims-4-v1-2-3/",
			cover: "https://www.skidrowreloaded.com/wp-content/uploads/sims4.jpg",
		});
		expect(hits[1]?.cover).toBeUndefined();
		expect(hits[2]?.title).toBe("The Sims 2 v7.8.9");
		expect(parseSkidrowTop("<html><body><h2>0 search results</h2></body></html>")).toEqual([]);
	});
});

describe("parseMagnet", () => {
	it("pega o primeiro e decodifica &#038;", () => {
		const html = `<a href="magnet:?xt=urn:btih:ABC&#038;dn=Jogo&#038;tr=udp%3A//t/announce">MAGNET</a>`;
		expect(parseMagnet(html)).toBe("magnet:?xt=urn:btih:ABC&dn=Jogo&tr=udp%3A//t/announce");
		expect(parseMagnet("<html>sem magnet</html>")).toBeNull();
	});
});

describe("SkidrowCatalog", () => {
	it("search devolve hits e o link da busca", async () => {
		const catalog = new SkidrowCatalog(new FakePageFetcher([[/skidrowreloaded/, { body: SKIDROW_HTML }]]));
		const { hits, searchUrl } = await catalog.search("the sims", 3);
		expect(hits.map((h) => h.title)).toEqual(["The Sims 4 v1.2.3", "The Sims 3 v4.5.6", "The Sims 2 v7.8.9"]);
		expect(searchUrl).toBe("https://www.skidrowreloaded.com/?s=the+sims&x=15&y=25");
	});

	it("search com HTTP de erro lanca", async () => {
		const catalog = new SkidrowCatalog(new FakePageFetcher([[/skidrowreloaded/, { status: 503, body: "" }]]));
		await expect(catalog.search("x", 3)).rejects.toThrow("HTTP 503 no Skidrow");
	});

	it("correctName limpa simbolos do nome da Steam; falha vira null", async () => {
		const ok = new SkidrowCatalog(
			new FakePageFetcher([[/storesearch/, { body: JSON.stringify({ items: [{ name: "The Sims™ 4" }] }) }]]),
		);
		expect(await ok.correctName("thesims")).toBe("The Sims 4");
		const down = new SkidrowCatalog(new FakePageFetcher([[/storesearch/, { status: 500, body: "" }]]));
		expect(await down.correctName("thesims")).toBeNull();
	});

	it("magnet: acha, erra sem magnet e recusa URL invalida", async () => {
		const catalog = new SkidrowCatalog(
			new FakePageFetcher([
				[/com-magnet/, { body: `<a href="magnet:?xt=urn:btih:ABC">M</a>` }],
				[/sem-magnet/, { body: "<html>nada</html>" }],
			]),
		);
		expect(await catalog.magnet("https://skidrow.exemplo/com-magnet/")).toBe("magnet:?xt=urn:btih:ABC");
		await expect(catalog.magnet("https://skidrow.exemplo/sem-magnet/")).rejects.toThrow("magnet não encontrado");
		await expect(catalog.magnet("ftp://x/y")).rejects.toThrow("inválida");
	});
});
