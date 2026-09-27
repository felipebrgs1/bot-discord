import type { Extraction, FamiliarMemory, MemoryHit } from "../../domain/memory.ts";

export interface MemoryStore {
	/** Ultimo seq de mensagem ja consolidado no canal (0 = nenhum). */
	cursor(channelId: string): number;
	/** Grava memorias, versoes, episodios e o cursor numa transacao so. */
	commit(channelId: string, extraction: Extraction, lastSeq: number): void;
	/**
	 * Familiaridade: preferencias/licoes da pessoa (ate 10) e
	 * preferencias/licoes/cultura do grupo no canal ou globais (ate 10).
	 */
	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] };
	/** Busca por palavras nas memorias ativas do canal ou globais. */
	search(channelId: string, text: string, limit: number): MemoryHit[];
}
