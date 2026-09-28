import { describe, expect, it } from "bun:test";
import { searchTerms } from "./search-terms.ts";

describe("searchTerms", () => {
	it("tira palavras vazias e curtas de pergunta em linguagem natural", () => {
		expect(searchTerms("Qual é o jogo favorito da Ana?")).toEqual(["jogo", "favorito", "ana"]);
	});

	it("mantem numeros curtos e siglas de tres letras", () => {
		expect(searchTerms("gta 5 ou lol")).toEqual(["gta", "5", "lol"]);
	});

	it("tira acento e o s do plural", () => {
		expect(searchTerms("Jogos FAVORITOS de ação")).toEqual(["jogo", "favorito", "acao"]);
	});

	it("simbolos e aspas viram separador; sem repeticao", () => {
		expect(searchTerms('"gato" OR ( gato')).toEqual(["gato"]);
	});

	it("plural de palavra vazia tambem sai", () => {
		expect(searchTerms("quais vocês viram mais gatos")).toEqual(["viram", "gato"]);
	});

	it("so palavras vazias devolve lista vazia", () => {
		expect(searchTerms("o que é isso")).toEqual([]);
	});
});
