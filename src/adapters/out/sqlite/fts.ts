import { searchTerms } from "../../../domain/search-terms.ts";

/** Expressao MATCH do FTS5: qualquer termo, por prefixo ('' = nada a buscar). */
export function ftsMatch(text: string): string {
	return searchTerms(text)
		.map((t) => `"${t}"*`)
		.join(" OR ");
}
