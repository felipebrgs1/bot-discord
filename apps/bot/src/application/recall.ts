/** O que o agente consulta sozinho: historico do canal (texto p/ o modelo). */

import type { HistorySearch } from "./ports/history-search.ts";

export interface HistoryRequest {
	channelId: string;
	query?: string;
	days?: number;
	authorId?: string;
	limit?: number;
}

const clamp = (value: number | undefined, fallback: number, max: number) => Math.min(Math.max(value ?? fallback, 1), max);

export class Recall {
	private readonly history: HistorySearch;

	constructor(history: HistorySearch) {
		this.history = history;
	}

	searchHistory(request: HistoryRequest): string {
		const hits = this.history.search({
			channelId: request.channelId,
			text: request.query?.trim(),
			days: request.days,
			authorId: request.authorId,
			limit: clamp(request.limit, 5, 10),
		});
		if (hits.length === 0) return "(nada encontrado no histórico)";
		return hits
			.map((h) => {
				const context = h.context.map((c) => `   │ ${c.authorName}: ${c.body.slice(0, 200)}`).join("\n");
				const when = h.createdAt.slice(0, 16).replace("T", " ");
				return `• ${h.authorName} (${when}): ${h.body.slice(0, 500)}${context ? `\n${context}` : ""}`;
			})
			.join("\n\n");
	}
}
