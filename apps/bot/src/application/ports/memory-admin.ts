import type { MemoryScope } from "@/domain/memory.ts";

export interface MemoryBlockRecord {
	scope: MemoryScope;
	ownerId: string;
	/** Nome de exibicao (pessoa: ultimo nome visto no historico; grupo: o canal). */
	name: string;
	entries: string[];
	updatedAt: string;
}

export interface MemoryBlockVersion {
	id: number;
	entries: string[];
	reason: string;
	createdAt: string;
}

export interface LearningEvent {
	at: string;
	kind: "memory" | "skill";
	channelId: string;
	subject: string;
	detail: string;
}

/** Leitura da memoria pelo painel (a escrita passa pela MemoryStore). */
export interface MemoryAdmin {
	/** Blocos ja escritos, grupo antes de pessoa, mais novos primeiro. */
	blocks(): MemoryBlockRecord[];
	/** Versoes do bloco, mais antigas primeiro. */
	versions(scope: MemoryScope, ownerId: string): MemoryBlockVersion[];
	/** Escritas de memoria e usos de skill, mais novos primeiro. */
	timeline(limit: number): LearningEvent[];
}
