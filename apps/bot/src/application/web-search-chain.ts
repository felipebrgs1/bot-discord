/** WebSearch em cascata: o primeiro buscador com resultado vence; erro ou vazio passa para o proximo. */

import type { WebSearch } from "./ports/web-search.ts";

export class WebSearchChain implements WebSearch {
	private readonly searchers: WebSearch[];

	constructor(searchers: WebSearch[]) {
		this.searchers = searchers;
	}

	async search(query: string, max: number): Promise<string> {
		if (this.searchers.length === 0) throw new Error("nenhum buscador configurado (TAVILY_API_KEY ou FIRECRAWL_API_KEY)");
		const errors: string[] = [];
		for (const searcher of this.searchers) {
			try {
				const text = await searcher.search(query, max);
				if (text.trim()) return text;
			} catch (err) {
				errors.push(err instanceof Error ? err.message : String(err));
			}
		}
		if (errors.length === this.searchers.length) throw new Error(errors.join("; "));
		return "";
	}
}
