/**
 * Caso de uso: responder uma mensagem que disparou o bot.
 *
 * Fila FIFO por canal (1 em andamento + ate 8 esperando; o resto e
 * descartado, como no bot Go), cooldown por canal contado so de respostas
 * que deram certo, papel do autor, resposta quebrada em pedacos do Discord.
 */

import { cooldownRemaining } from "../domain/cooldown.ts";
import type { ImageData } from "../domain/image.ts";
import { splitMessage } from "../domain/reply-split.ts";
import { roleOf } from "../domain/roles.ts";
import type { ChatAgent } from "./ports/chat-agent.ts";
import type { Clock } from "./ports/clock.ts";
import type { Logger } from "./ports/logger.ts";

export interface IncomingMessage {
	channelId: string;
	authorId: string;
	text: string;
	images: readonly ImageData[];
}

/** Onde a resposta vai parar; implementado pelo adapter de entrada. */
export interface ReplyTarget {
	whileWorking<T>(work: () => Promise<T>): Promise<T>;
	deliver(chunks: readonly string[]): Promise<void>;
	fail(message: string): Promise<void>;
}

export interface ReplySettings {
	cooldownMs: number;
	adminIds: readonly string[];
}

export interface ReplyDeps {
	agent: ChatAgent;
	clock: Clock;
	logger: Logger;
	settings: () => ReplySettings;
}

const MAX_WAITING = 8;

interface Job {
	message: IncomingMessage;
	target: ReplyTarget;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ReplyToMessage {
	private readonly deps: ReplyDeps;
	private readonly waiting = new Map<string, Job[]>();
	private readonly running = new Map<string, Promise<void>>();
	private readonly lastReply = new Map<string, number>();

	constructor(deps: ReplyDeps) {
		this.deps = deps;
	}

	/** Enfileira; false quando a fila do canal esta cheia (mensagem descartada). */
	submit(message: IncomingMessage, target: ReplyTarget): boolean {
		const { channelId } = message;
		const queue = this.waiting.get(channelId) ?? [];
		if (this.running.has(channelId) && queue.length >= MAX_WAITING) return false;
		queue.push({ message, target });
		this.waiting.set(channelId, queue);
		if (!this.running.has(channelId)) {
			this.running.set(
				channelId,
				this.drain(channelId).finally(() => this.running.delete(channelId)),
			);
		}
		return true;
	}

	/** Resolve quando nenhum canal tem resposta em andamento. */
	async idle(): Promise<void> {
		while (this.running.size > 0) await Promise.all(this.running.values());
	}

	/** Descarta o que esta esperando; a resposta em andamento termina. */
	stop(): void {
		this.waiting.clear();
	}

	private async drain(channelId: string): Promise<void> {
		for (;;) {
			const job = this.waiting.get(channelId)?.shift();
			if (!job) return;
			await this.reply(job);
		}
	}

	private async reply({ message, target }: Job): Promise<void> {
		const { clock, logger, agent } = this.deps;
		const settings = this.deps.settings();
		const wait = cooldownRemaining(clock.now(), this.lastReply.get(message.channelId), settings.cooldownMs);
		if (wait > 0) await clock.sleep(wait);
		const role = roleOf(message.authorId, settings.adminIds);
		logger.info(`resposta canal=${message.channelId} role=${role} len=${message.text.length}`);
		try {
			const answer = await target.whileWorking(() => agent.ask({ ...message, role }));
			logger.info(`resposta ok canal=${message.channelId} len=${answer.length}`);
			this.lastReply.set(message.channelId, clock.now());
			await target.deliver(splitMessage(answer));
		} catch (err) {
			logger.warn(`resposta ERRO canal=${message.channelId}: ${errorText(err)}`);
			await target.fail(`falhei aqui: ${errorText(err)}`);
		}
	}
}
