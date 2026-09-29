/**
 * Consolidacao: por canal com mensagens novas desde o cursor, o modelo ve o
 * lote e as memorias atuais (do grupo e de quem falou) e devolve memorias
 * novas/atualizadas, esquecidas, reafirmadas e episodios; grava tudo e o
 * cursor de uma vez.
 * Falha do modelo nao avanca o cursor (o lote e tentado de novo depois).
 */

import { extractionPrompt, validateExtraction } from "../domain/memory.ts";
import type { LearningExtractor } from "./ports/learning-extractor.ts";
import type { Logger } from "./ports/logger.ts";
import type { MemoryStore } from "./ports/memory-store.ts";
import type { MessageStore } from "./ports/message-store.ts";

export interface ConsolidateDeps {
	messages: MessageStore;
	memories: MemoryStore;
	extractor: LearningExtractor;
	logger: Logger;
}

export interface ConsolidateOptions {
	batchSize?: number;
	minNew?: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ConsolidateMemory {
	private readonly deps: ConsolidateDeps;

	constructor(deps: ConsolidateDeps) {
		this.deps = deps;
	}

	async channel(channelId: string, opts: ConsolidateOptions = {}): Promise<{ consolidated: boolean; memories: number }> {
		const { messages, memories, extractor, logger } = this.deps;
		const batch = messages.after(channelId, memories.cursor(channelId), opts.batchSize ?? 10);
		const last = batch.at(-1);
		if (!last || batch.length < (opts.minNew ?? 3)) return { consolidated: false, memories: 0 };
		const people = [...new Set(batch.filter((m) => !m.fromBot).map((m) => m.authorId))];
		const known = memories.known(channelId, people);
		let raw: unknown;
		try {
			raw = await extractor.complete(extractionPrompt(channelId, batch, known));
		} catch (err) {
			logger.warn(`consolidação falhou (extração) canal=${channelId}: ${errorText(err)}`);
			return { consolidated: false, memories: 0 };
		}
		const extraction = validateExtraction(raw, people, known);
		memories.commit(channelId, extraction, last.seq);
		logger.info(`memory_consolidated canal=${channelId} memorias=${extraction.memories.length}`);
		return { consolidated: true, memories: extraction.memories.length };
	}

	async all(channelIds: readonly string[], opts: ConsolidateOptions = {}): Promise<{ channels: number; memories: number }> {
		let channels = 0;
		let memories = 0;
		for (const channelId of channelIds) {
			try {
				const r = await this.channel(channelId, opts);
				if (r.consolidated) {
					channels += 1;
					memories += r.memories;
				}
			} catch (err) {
				this.deps.logger.warn(`consolidação falhou (gravação) canal=${channelId}: ${errorText(err)}`);
			}
		}
		return { channels, memories };
	}
}
