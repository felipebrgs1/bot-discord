import type { MemoryBlockRef } from "../../domain/memory.ts";

/** Blocos de memoria (grupo por canal, pessoa global) e o cursor da revisao. */
export interface MemoryStore {
	/** Entradas do bloco, na ordem; vazio se nunca foi escrito. */
	read(ref: MemoryBlockRef): string[];
	/** Troca o bloco inteiro e registra a versao com o motivo. */
	write(ref: MemoryBlockRef, entries: readonly string[], reason: string): void;
	/** Ultimo seq de mensagem ja revisado no canal (0 = nenhum). */
	cursor(channelId: string): number;
	setCursor(channelId: string, seq: number): void;
}
