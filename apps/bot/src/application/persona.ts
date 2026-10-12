import { MEMORY_GUIDANCE, MEMORY_LIMITS, memoryBlockText, turnText } from "@/domain/memory.ts";
import { DECISION_GUIDANCE } from "@/domain/verdict.ts";
import type { MemoryStore } from "./ports/memory-store.ts";
import type { MessageStore } from "./ports/message-store.ts";
import type { SoulStore } from "./ports/soul-store.ts";

export interface Turn {
	channelId: string;
	authorId: string;
	authorName: string;
	/** A propria mensagem (ja gravada no historico) fica fora da conversa recente. */
	messageId: string;
	text: string;
	/** Imagens anexadas vieram de mensagens anteriores do canal, nao desta. */
	borrowedImages?: boolean;
}

const RECENT_LIMIT = 15;

/**
 * Prompt da sessao (soul + como usar a memoria + bloco do grupo: congelado na
 * criacao da sessao) e texto de cada turno (quem fala + bloco dela + conversa
 * recente).
 */
export class Persona {
	private readonly souls: SoulStore;
	private readonly memories: MemoryStore;
	private readonly messages: MessageStore;

	constructor(souls: SoulStore, memories: MemoryStore, messages: MessageStore) {
		this.souls = souls;
		this.memories = memories;
		this.messages = messages;
	}

	systemPromptFor(channelId: string): string {
		const group = this.memories.read({ scope: "group", ownerId: channelId });
		return [this.souls.bodyFor(channelId), MEMORY_GUIDANCE, DECISION_GUIDANCE, memoryBlockText("memória do grupo", group, MEMORY_LIMITS.group)]
			.filter(Boolean)
			.join("\n\n");
	}

	turnText(turn: Turn): string {
		const memory = this.memories.read({ scope: "user", ownerId: turn.authorId });
		const recent = this.messages
			.sinceLastBotMessage(turn.channelId, RECENT_LIMIT + 1)
			.filter((m) => m.messageId !== turn.messageId)
			.slice(-RECENT_LIMIT);
		return turnText({ ...turn, memory, recent });
	}
}
