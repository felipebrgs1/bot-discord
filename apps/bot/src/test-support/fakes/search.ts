import { searchTerms } from "../../domain/search-terms.ts";

/** Quantos termos da busca casam por prefixo com alguma palavra do texto (mesma regra do FTS). */
export function matchCount(query: string, text: string): number {
	const words = searchTerms(text);
	return searchTerms(query).filter((t) => words.some((w) => w.startsWith(t))).length;
}
