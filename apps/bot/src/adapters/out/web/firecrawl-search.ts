/** WebSearch pela API v2 do Firecrawl (plano free com creditos); noticias e web, Brasil. */

import type { WebSearch } from "../../../application/ports/web-search.ts";

export interface FirecrawlSearchOptions {
	apiKey: string;
	http?: typeof fetch;
	timeoutMs?: number;
}

interface FirecrawlItem {
	title?: string;
	url?: string;
	description?: string;
	snippet?: string;
	date?: string;
}

interface FirecrawlResponse {
	data?: { web?: FirecrawlItem[]; news?: FirecrawlItem[] };
}

function section(label: string, items: FirecrawlItem[]): string[] {
	if (items.length === 0) return [];
	return [
		label,
		...items.map((r, n) => {
			const link = r.date ? `${r.url ?? ""} | ${r.date}` : (r.url ?? "");
			const excerpt = r.snippet ?? r.description;
			return `${n + 1}. ${r.title ?? ""}\n   Link: ${link}${excerpt ? `\n   ${excerpt}` : ""}`;
		}),
	];
}

export class FirecrawlSearch implements WebSearch {
	private readonly opts: FirecrawlSearchOptions;

	constructor(opts: FirecrawlSearchOptions) {
		this.opts = opts;
	}

	async search(query: string, max: number): Promise<string> {
		const http = this.opts.http ?? fetch;
		const res = await http("https://api.firecrawl.dev/v2/search", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
			body: JSON.stringify({ query, limit: max, sources: ["web", "news"], country: "BR" }),
			signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
		});
		if (!res.ok) throw new Error(`firecrawl HTTP ${res.status}`);
		const data = ((await res.json()) as FirecrawlResponse).data ?? {};
		return [
			...section("Notícias:", (data.news ?? []).slice(0, max)),
			...section("Web:", (data.web ?? []).slice(0, max)),
		].join("\n");
	}
}
