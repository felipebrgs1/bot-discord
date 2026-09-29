import type { MemoryStatus } from "../../domain/memory.ts";

export interface MemoryRecord {
	id: number;
	channelId: string;
	scope: string;
	personId: string;
	key: string;
	kind: string;
	status: string;
	content: string;
	versions: number;
	updatedAt: string;
}

export interface MemoryVersion {
	id: number;
	content: string;
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

/** Curadoria das memorias pelo painel. */
export interface MemoryAdmin {
	/** Ativas, mais novas primeiro. */
	listActive(limit: number): MemoryRecord[];
	find(id: number): MemoryRecord | undefined;
	versions(id: number): MemoryVersion[];
	/** false se a memoria nao existe. Registra versao com o motivo. */
	setStatus(id: number, status: MemoryStatus, reason: string): boolean;
	/** Troca o conteudo e reativa. false se nao existe. */
	correct(id: number, content: string, reason: string): boolean;
	/** Versoes de memoria e usos de skill, mais novos primeiro. */
	timeline(limit: number): LearningEvent[];
}
