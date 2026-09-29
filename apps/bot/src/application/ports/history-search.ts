export interface HistoryQuery {
	channelId: string;
	/** Palavras (todas precisam aparecer). Vazio = mais recentes. */
	text?: string;
	/** So dos ultimos N dias. */
	days?: number;
	authorId?: string;
	limit: number;
}

export interface HistoryHit {
	authorName: string;
	body: string;
	createdAt: string;
	/** Ate 4 mensagens vizinhas (2 antes, 2 depois), sem a propria. */
	context: { authorName: string; body: string }[];
}

/** "Lembra quando...": busca no historico de um canal. */
export interface HistorySearch {
	search(query: HistoryQuery): HistoryHit[];
}
