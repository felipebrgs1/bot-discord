/** Mensagem do historico de um canal (Discord ou sessao web). */
export interface NewMessage {
	channelId: string;
	authorId: string;
	authorName: string;
	messageId: string;
	body: string;
	replyTo?: string;
	/** Escrita por um bot (inclusive este); ausente = nao. */
	fromBot?: boolean;
	/** ISO; ausente = agora. */
	createdAt?: string;
}

export interface StoredMessage {
	/** Ordem de chegada no canal (crescente). */
	seq: number;
	channelId: string;
	authorId: string;
	authorName: string;
	messageId: string;
	body: string;
	replyTo: string | null;
	createdAt: string;
	fromBot: boolean;
}

export const MAX_STORED_BODY = 4000;
