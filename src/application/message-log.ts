import { MAX_STORED_BODY, type NewMessage } from "../domain/message.ts";
import type { Logger } from "./ports/logger.ts";
import type { MessageStore } from "./ports/message-store.ts";

/** Guarda o historico do canal; falha aqui nunca quebra a resposta. */
export class MessageLog {
	private readonly store: MessageStore;
	private readonly logger: Logger;

	constructor(store: MessageStore, logger: Logger) {
		this.store = store;
		this.logger = logger;
	}

	record(message: NewMessage): void {
		try {
			this.store.append({ ...message, body: message.body.slice(0, MAX_STORED_BODY) });
		} catch (err) {
			this.logger.warn(`historico ERRO canal=${message.channelId}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
