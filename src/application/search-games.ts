/**
 * Busca de jogo (/lista e tool lista): top 3 do catalogo; sem resultado,
 * tenta o nome oficial ("thesims" -> "The Sims 4") e busca de novo.
 */

import { formatGameList, type GameHit, normalizeGameName } from "../domain/game.ts";
import type { GameCatalog } from "./ports/game-catalog.ts";

export interface GameSearch {
	text: string;
	hits: GameHit[];
	displayName: string;
	correctedFrom?: string;
}

export class SearchGames {
	private readonly catalog: GameCatalog;

	constructor(catalog: GameCatalog) {
		this.catalog = catalog;
	}

	async search(name: string, limit = 3): Promise<GameSearch> {
		const wanted = normalizeGameName(name);
		if (!wanted) throw new Error("informe o nome do jogo (ex.: the sims)");
		const direct = await this.catalog.search(wanted, limit);
		if (direct.hits.length > 0) {
			return { text: formatGameList(direct.hits, direct.searchUrl), hits: direct.hits, displayName: wanted };
		}
		const corrected = await this.catalog.correctName(wanted);
		if (corrected && corrected.toLowerCase() !== wanted.toLowerCase()) {
			const fixed = await this.catalog.search(corrected, limit);
			if (fixed.hits.length > 0) {
				return {
					text: `Nome corrigido: ${wanted} → ${corrected}\n${formatGameList(fixed.hits, fixed.searchUrl)}`,
					hits: fixed.hits,
					displayName: corrected,
					correctedFrom: wanted,
				};
			}
		}
		return { text: formatGameList([], direct.searchUrl), hits: [], displayName: wanted };
	}

	magnet(postUrl: string): Promise<string> {
		return this.catalog.magnet(postUrl);
	}
}
