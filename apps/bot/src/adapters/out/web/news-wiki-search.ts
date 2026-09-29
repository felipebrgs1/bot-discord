/** WebSearch sem chave: Google News RSS (pt-BR); vazio cai para Wikipedia + DuckDuckGo Instant. */

import type { PageFetcher } from "../../../application/ports/page-fetcher.ts";
import type { WebSearch } from "../../../application/ports/web-search.ts";

function splitNewsTitle(t: string): [string, string] {
	const i = t.lastIndexOf(" - ");
	if (i > 0 && i < t.length - 3) return [t.slice(0, i).trim(), t.slice(i + 3).trim()];
	return [t.trim(), "?"];
}

function brDate(raw: string): string {
	const parsed = Date.parse(raw);
	if (Number.isNaN(parsed)) return raw;
	const d = new Date(parsed);
	const two = (n: number) => String(n).padStart(2, "0");
	return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

export class NewsWikiSearch implements WebSearch {
	private readonly fetcher: PageFetcher;

	constructor(fetcher: PageFetcher) {
		this.fetcher = fetcher;
	}

	async search(query: string, max: number): Promise<string> {
		const news = await this.news(query, max);
		if (news.trim()) return news;
		const wiki = await this.wiki(query).catch(() => "");
		const instant = await this.instant(query).catch(() => "");
		return [wiki, instant].filter((s) => s.trim()).join("\n");
	}

	private async news(query: string, max: number): Promise<string> {
		const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=BR&ceid=BR%3Apt-419`;
		const { status, text } = await this.fetcher.text(url, 1 << 20);
		if (status !== 200) return "";
		const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, max);
		if (items.length === 0) return "";
		const out = ["Notícias recentes:"];
		items.forEach((m, n) => {
			const part = m[1] ?? "";
			const tag = (t: string): string => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(part)?.[1]?.trim() ?? "";
			const [title, source] = splitNewsTitle(tag("title").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, "$1"));
			out.push(`${n + 1}. ${title}\n   Fonte: ${source} | ${brDate(tag("pubDate"))}\n   Link: ${tag("link")}`);
		});
		return out.join("\n");
	}

	private async wiki(query: string): Promise<string> {
		const found = (await this.fetcher.json(
			`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json`,
		)) as { query?: { search?: { title?: string }[] } };
		const title = found.query?.search?.[0]?.title;
		if (!title) return "";
		const page = (await this.fetcher.json(
			`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
		)) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
		if (!page.extract) return "";
		return `Wikipedia — ${page.title}: ${page.extract}\nLink: ${page.content_urls?.desktop?.page ?? ""}\n`;
	}

	private async instant(query: string): Promise<string> {
		const r = (await this.fetcher.json(
			`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&kl=br-pt`,
		)) as { AbstractText?: string; AbstractURL?: string; Answer?: string };
		const out: string[] = [];
		if (r.AbstractText) out.push(`Resumo: ${r.AbstractText}\nFonte: ${r.AbstractURL ?? ""}`);
		if (r.Answer) out.push(`Resposta direta: ${r.Answer}`);
		return out.join("\n");
	}
}
