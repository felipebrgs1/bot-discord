/**
 * GameCatalog sobre o Skidrow Reloaded (busca = ?s=nome+com+mais) e o
 * catalogo da Steam para corrigir nome grudado ("thesims" -> "The Sims 4").
 */

import type { GameCatalog } from "../../../application/ports/game-catalog.ts";
import type { PageFetcher } from "../../../application/ports/page-fetcher.ts";
import { type GameHit, normalizeGameName } from "../../../domain/game.ts";
import { unescapeHtml } from "../../../domain/html-text.ts";
import { parseHttpUrl } from "../../../domain/http-url.ts";

const SEARCH_BASE = "https://www.skidrowreloaded.com/";

/** Espaco vira "+", resto URL-encoded (ex.: "the sims" -> "?s=the+sims&x=15&y=25"). */
export function skidrowSearchUrl(name: string): string {
	const normalized = normalizeGameName(name);
	if (!normalized) throw new Error("nome do jogo vazio");
	return `${SEARCH_BASE}?s=${normalized.split(" ").map(encodeURIComponent).join("+")}&x=15&y=25`;
}

/** Resultados da pagina de busca (<h2><a href>) com capa casada pelo alt da imagem. */
export function parseSkidrowTop(html: string, limit = 3): GameHit[] {
	const covers = new Map<string, string>();
	for (const tag of html.match(/<img[^>]+>/gi) ?? []) {
		const src = /src="([^"]+)"/i.exec(tag)?.[1]?.trim();
		const alt = unescapeHtml(/alt="([^"]*)"/i.exec(tag)?.[1]?.trim() ?? "");
		if (src && alt && !covers.has(alt)) covers.set(alt, src);
	}
	const out: GameHit[] = [];
	const re = /<h2[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
	for (let m = re.exec(html); m && out.length < limit; m = re.exec(html)) {
		const url = (m[1] ?? "").trim();
		const title = unescapeHtml((m[2] ?? "").replace(/<[^>]+>/g, "").trim());
		if (!url || !title) continue;
		const cover = covers.get(title);
		out.push(cover ? { title, url, cover } : { title, url });
	}
	return out;
}

export function parseMagnet(html: string): string | null {
	const m = /magnet:\?[^"<>\s]+/.exec(html)?.[0];
	return m ? unescapeHtml(m) : null;
}

export class SkidrowCatalog implements GameCatalog {
	private readonly fetcher: PageFetcher;

	constructor(fetcher: PageFetcher) {
		this.fetcher = fetcher;
	}

	async search(name: string, limit: number): Promise<{ hits: GameHit[]; searchUrl: string }> {
		const searchUrl = skidrowSearchUrl(name);
		const { status, text } = await this.fetcher.text(searchUrl);
		if (status < 200 || status >= 300) throw new Error(`HTTP ${status} no Skidrow`);
		return { hits: parseSkidrowTop(text, limit), searchUrl };
	}

	async correctName(name: string): Promise<string | null> {
		let data: { items?: { name?: string }[] };
		try {
			data = (await this.fetcher.json(
				`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=BR`,
			)) as { items?: { name?: string }[] };
		} catch {
			return null;
		}
		const clean = (data.items?.[0]?.name ?? "").replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
		return clean || null;
	}

	async magnet(postUrl: string): Promise<string> {
		const url = parseHttpUrl(postUrl);
		if (!url) throw new Error("URL da postagem inválida");
		const { status, text } = await this.fetcher.text(url.toString());
		if (status < 200 || status >= 300) throw new Error(`HTTP ${status} no Skidrow`);
		const magnet = parseMagnet(text);
		if (!magnet) throw new Error("magnet não encontrado na página");
		return magnet;
	}
}
