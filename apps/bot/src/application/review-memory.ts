/**
 * Revisao em segundo plano (o "self-improvement review" do Hermes): por canal
 * com mensagens novas desde o cursor, o modelo ve o lote e os blocos atuais
 * (grupo + quem falou) e propoe edicoes. Cada edicao passa pelas mesmas regras
 * da tool; a recusada (teto, trecho) e pulada e logada.
 * Falha do modelo nao avanca o cursor (o lote e tentado de novo depois).
 */

import { parseReviewEdits, reviewPrompt } from "../domain/memory.ts";
import type { AgentMemory } from "./agent-memory.ts";
import type { LearningExtractor } from "./ports/learning-extractor.ts";
import type { Logger } from "./ports/logger.ts";
import type { MemoryStore } from "./ports/memory-store.ts";
import type { MessageStore } from "./ports/message-store.ts";

export interface ReviewDeps {
	messages: MessageStore;
	store: MemoryStore;
	memory: AgentMemory;
	extractor: LearningExtractor;
	logger: Logger;
}

export interface ReviewOptions {
	batchSize?: number;
	minNew?: number;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ReviewMemory {
	private readonly deps: ReviewDeps;

	constructor(deps: ReviewDeps) {
		this.deps = deps;
	}

	async channel(channelId: string, opts: ReviewOptions = {}): Promise<{ reviewed: boolean; edits: number }> {
		const { messages, store, memory, extractor, logger } = this.deps;
		const batch = messages.after(channelId, store.cursor(channelId), opts.batchSize ?? 10);
		const last = batch.at(-1);
		if (!last || batch.length < (opts.minNew ?? 3)) return { reviewed: false, edits: 0 };
		const people = new Map(batch.filter((m) => !m.fromBot).map((m) => [m.authorId, m.authorName]));
		const blocks = {
			group: store.read({ scope: "group", ownerId: channelId }),
			people: [...people].map(([personId, name]) => ({ personId, name, entries: store.read({ scope: "user", ownerId: personId }) })),
		};
		let raw: unknown;
		try {
			raw = await extractor.complete(reviewPrompt(batch, blocks));
		} catch (err) {
			logger.warn(`revisão de memória falhou canal=${channelId}: ${errorText(err)}`);
			return { reviewed: false, edits: 0 };
		}
		let applied = 0;
		for (const { ref, edit } of parseReviewEdits(raw, channelId, [...people.keys()])) {
			const result = memory.edit(ref, edit, `revisão: ${edit.action}`);
			if (result.ok) applied += 1;
			else logger.warn(`revisão de memória recusada canal=${channelId} ${ref.scope}:${ref.ownerId} ${edit.action}: ${result.error}`);
		}
		store.setCursor(channelId, last.seq);
		logger.info(`memory_reviewed canal=${channelId} edicoes=${applied}`);
		return { reviewed: true, edits: applied };
	}

	async all(channelIds: readonly string[], opts: ReviewOptions = {}): Promise<{ channels: number; edits: number }> {
		let channels = 0;
		let edits = 0;
		for (const channelId of channelIds) {
			try {
				const r = await this.channel(channelId, opts);
				if (r.reviewed) {
					channels += 1;
					edits += r.edits;
				}
			} catch (err) {
				this.deps.logger.warn(`revisão de memória falhou (gravação) canal=${channelId}: ${errorText(err)}`);
			}
		}
		return { channels, edits };
	}
}
