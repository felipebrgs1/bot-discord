/** Depois da resposta, envia ao canal o que as tools largaram no outbox (ate 3) e descarta. */

import type { Logger } from "./ports/logger.ts";
import type { Outbox } from "./ports/outbox.ts";

const MAX_PER_REPLY = 3;

export class OutboxDelivery {
	private readonly outbox: Outbox;
	private readonly logger: Logger;

	constructor(outbox: Outbox, logger: Logger) {
		this.outbox = outbox;
		this.logger = logger;
	}

	async deliver(channelId: string, send: (path: string) => Promise<void>): Promise<void> {
		const files = await this.outbox.pending(channelId);
		for (const file of files.slice(0, MAX_PER_REPLY)) {
			try {
				await send(file);
			} catch (err) {
				this.logger.warn(`anexo ERRO canal=${channelId}: ${err instanceof Error ? err.message : String(err)}`);
				break;
			} finally {
				await this.outbox.discard(file);
			}
		}
	}
}
