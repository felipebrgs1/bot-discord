/** Pesquisa e leitura de pagina para o agente (texto pronto; erro vira texto, nunca excecao). */

import { htmlToText } from "../domain/html-text.ts";
import { parseHttpUrl } from "../domain/http-url.ts";
import type { PageFetcher } from "./ports/page-fetcher.ts";
import type { WebSearch } from "./ports/web-search.ts";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const clamp = (value: number | undefined, fallback: number, max: number) => Math.min(Math.max(value ?? fallback, 1), max);

export class WebResearch {
	private readonly searcher: WebSearch;
	private readonly fetcher: PageFetcher;

	constructor(searcher: WebSearch, fetcher: PageFetcher) {
		this.searcher = searcher;
		this.fetcher = fetcher;
	}

	async search(query: string, max?: number): Promise<string> {
		const q = query.trim();
		if (!q) return "erro: query vazia";
		try {
			const out = await this.searcher.search(q, clamp(max, 5, 10));
			return out.trim() || "(sem resultados para essa busca)";
		} catch (err) {
			return `erro na pesquisa: ${errorText(err)}`;
		}
	}

	async read(rawUrl: string, maxChars?: number): Promise<string> {
		const url = parseHttpUrl(rawUrl);
		if (!url) return "erro: URL inválida (use http/https)";
		try {
			const { status, text: page } = await this.fetcher.text(url.toString());
			if (status < 200 || status >= 300) return `erro: HTTP ${status}`;
			const { title, text } = htmlToText(page);
			if (!text.trim()) return "erro: página sem texto extraível";
			return (title ? `Título: ${title}\n\n${text}` : text).slice(0, clamp(maxChars, 8000, 20000));
		} catch (err) {
			return `erro: ${errorText(err)}`;
		}
	}
}
