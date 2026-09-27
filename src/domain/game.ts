/** Resultado de busca de jogo (catalogo externo, hoje Skidrow). */
export interface GameHit {
	title: string;
	url: string;
	cover?: string;
}

export function normalizeGameName(name: string): string {
	return name.trim().replace(/\s+/g, " ");
}

/** Top numerado; sem resultado, o link da busca. */
export function formatGameList(hits: readonly GameHit[], searchUrl: string): string {
	if (hits.length === 0) return `(nada encontrado; busca: ${searchUrl})`;
	return hits.map((h, n) => `${n + 1}. ${h.title}\n${h.url}`).join("\n");
}
