import type { Extraction, FamiliarMemory, MemoryHit } from "../../domain/memory.ts";

export interface MemoryStore {
	/** Ultimo seq de mensagem ja consolidado no canal (0 = nenhum). */
	cursor(channelId: string): number;
	/**
	 * Grava memorias (mesma key = atualiza; mesmo conteudo = reafirma), forget,
	 * confirm, episodios e o cursor numa transacao so. Memoria de pessoa vale
	 * em todos os canais.
	 */
	commit(channelId: string, extraction: Extraction, lastSeq: number): void;
	/** Ativas que o extrator precisa ver: do grupo no canal (ou globais) e das pessoas dadas. */
	known(channelId: string, personIds: readonly string[]): MemoryHit[];
	/**
	 * Familiaridade, ate 10 de cada: da pessoa (preferencias/licoes antes de
	 * fatos) e do grupo no canal ou globais (preferencias/licoes/cultura). Dentro
	 * disso, mais reafirmadas e mais recentes primeiro.
	 */
	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] };
	/** Busca por palavras nas memorias ativas do canal, globais ou de pessoa, e nos episodios do canal. */
	search(channelId: string, text: string, limit: number): MemoryHit[];
}
