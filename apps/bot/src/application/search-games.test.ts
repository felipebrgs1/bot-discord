import { describe, expect, it } from "bun:test";
import type { GameHit } from "../domain/game.ts";
import type { GameCatalog } from "./ports/game-catalog.ts";
import { SearchGames } from "./search-games.ts";

const sims: GameHit[] = [{ title: "The Sims 4", url: "https://s/4" }];

function catalog(byName: Record<string, GameHit[]>, correction: string | null = null) {
	const searched: string[] = [];
	const fake: GameCatalog = {
		search: async (name) => {
			searched.push(name);
			return { hits: byName[name] ?? [], searchUrl: `https://busca?s=${name}` };
		},
		correctName: async () => correction,
		magnet: async (url) => `magnet:?de=${url}`,
	};
	return { searched, fake };
}

describe("SearchGames.search", () => {
	it("acerto direto: lista e nao tenta corrigir", async () => {
		const { searched, fake } = catalog({ "the sims": sims }, "nunca");
		const r = await new SearchGames(fake).search("  the   sims ");
		expect(r).toEqual({ text: "1. The Sims 4\nhttps://s/4", hits: sims, displayName: "the sims" });
		expect(searched).toEqual(["the sims"]);
	});

	it("vazio: corrige o nome pelo catalogo e busca de novo", async () => {
		const { fake } = catalog({ "The Sims 4": sims }, "The Sims 4");
		const r = await new SearchGames(fake).search("thesims");
		expect(r.correctedFrom).toBe("thesims");
		expect(r.displayName).toBe("The Sims 4");
		expect(r.text).toBe("Nome corrigido: thesims → The Sims 4\n1. The Sims 4\nhttps://s/4");
	});

	it("correcao igual ao nome (ignorando caixa) nao busca de novo", async () => {
		const { searched, fake } = catalog({}, "THESIMS");
		const r = await new SearchGames(fake).search("thesims");
		expect(searched).toEqual(["thesims"]);
		expect(r.text).toBe("(nada encontrado; busca: https://busca?s=thesims)");
	});

	it("nome vazio e erro", async () => {
		await expect(new SearchGames(catalog({}).fake).search("   ")).rejects.toThrow("informe o nome do jogo");
	});
});

describe("SearchGames.magnet", () => {
	it("repassa ao catalogo", async () => {
		expect(await new SearchGames(catalog({}).fake).magnet("https://s/4")).toBe("magnet:?de=https://s/4");
	});
});
