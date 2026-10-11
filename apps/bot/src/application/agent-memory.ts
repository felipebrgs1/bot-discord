/**
 * Caso de uso: escrever na memoria em blocos (tool do agente, revisao em
 * segundo plano e painel). A regra (teto, trecho unico) mora no dominio; aqui
 * le o bloco, aplica e so grava o que deu certo.
 */

import {
	applyMemoryEdit,
	type EditResult,
	MEMORY_LIMITS,
	type MemoryBlockRef,
	type MemoryEdit,
	memoryBlockText,
	replaceBlock,
} from "../domain/memory.ts";
import type { MemoryStore } from "./ports/memory-store.ts";

const titleOf = (ref: MemoryBlockRef) => (ref.scope === "group" ? "memória do grupo" : `memória da pessoa ${ref.ownerId}`);

export class AgentMemory {
	private readonly store: MemoryStore;

	constructor(store: MemoryStore) {
		this.store = store;
	}

	edit(ref: MemoryBlockRef, edit: MemoryEdit, reason: string): EditResult {
		return this.save(ref, applyMemoryEdit(this.store.read(ref), edit, MEMORY_LIMITS[ref.scope]), reason);
	}

	/** Troca o bloco inteiro (painel). */
	replace(ref: MemoryBlockRef, entries: readonly string[], reason: string): EditResult {
		return this.save(ref, replaceBlock(this.store.read(ref), entries, MEMORY_LIMITS[ref.scope]), reason);
	}

	/** Resultado para o modelo: o bloco como ficou, ou o erro com o bloco atual para ele consolidar. */
	forTool(ref: MemoryBlockRef, edit: MemoryEdit): string {
		const result = this.edit(ref, edit, `tool: ${edit.action}`);
		const limit = MEMORY_LIMITS[ref.scope];
		if (result.ok) return `ok. ${memoryBlockText(titleOf(ref), result.entries, limit)}`;
		return `erro: ${result.error}\n${memoryBlockText(titleOf(ref), this.store.read(ref), limit)}`;
	}

	private save(ref: MemoryBlockRef, result: EditResult, reason: string): EditResult {
		if (result.ok) this.store.write(ref, result.entries, reason);
		return result;
	}
}
