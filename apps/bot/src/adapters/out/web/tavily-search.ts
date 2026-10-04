/** WebSearch pela API do Tavily (plano free com cota mensal); traz resposta direta + resultados. */

import type { WebSearch } from "../../../application/ports/web-search.ts";

export interface TavilySearchOptions {
	apiKey: string;
	http?: typeof fetch;
	timeoutMs?: number;
}

interface TavilyResponse {
	answer?: string | null;
	results?: { title?: string; url?: string; content?: string; published_date?: string }[];
}

export class TavilySearch implements WebSearch {
	private readonly opts: TavilySearchOptions;

	constructor(opts: TavilySearchOptions) {
		this.opts = opts;
	}

	async search(query: string, max: number): Promise<string> {
		const http = this.opts.http ?? fetch;
		const res = await http("https://api.tavily.com/search", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
			body: JSON.stringify({
				query,
				max_results: max,
				search_depth: "basic",
				include_answer: true,
				include_published_date: true,
			}),
			signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
		});
		if (!res.ok) throw new Error(`tavily HTTP ${res.status}`);
		const data = (await res.json()) as TavilyResponse;
		const results = data.results ?? [];
		if (results.length === 0) return "";
		const out: string[] = [];
		if (data.answer) out.push(`Resposta direta: ${data.answer}`);
		results.slice(0, max).forEach((r, n) => {
			const link = r.published_date ? `${r.url ?? ""} | ${r.published_date}` : (r.url ?? "");
			out.push(`${n + 1}. ${r.title ?? ""}\n   Link: ${link}${r.content ? `\n   ${r.content}` : ""}`);
		});
		return out.join("\n");
	}
}
