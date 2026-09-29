import type { GameHit } from "../../domain/game.ts";

export interface GameCatalog {
	/** Top `limit` do catalogo + link da busca feita. */
	search(name: string, limit: number): Promise<{ hits: GameHit[]; searchUrl: string }>;
	/** Nome oficial parecido (ex.: "thesims" -> "The Sims 4"), ou null. */
	correctName(name: string): Promise<string | null>;
	/** Link magnetico da postagem; lanca se nao houver. */
	magnet(postUrl: string): Promise<string>;
}
