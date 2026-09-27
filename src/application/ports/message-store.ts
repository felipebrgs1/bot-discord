import type { NewMessage, StoredMessage } from "../../domain/message.ts";

export interface MessageStore {
	/** Grava; undefined se o messageId ja existia (idempotente). */
	append(message: NewMessage): StoredMessage | undefined;
	/** Mais antigas primeiro. */
	listChannel(channelId: string, limit: number): StoredMessage[];
	deleteChannel(channelId: string): void;
	/** Mensagens com seq > afterSeq, mais antigas primeiro. */
	after(channelId: string, afterSeq: number, limit: number): StoredMessage[];
}
