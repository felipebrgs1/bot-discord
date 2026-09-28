import { groupMemoryText, turnText } from "../domain/memory.ts";
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
}

const RECENT_LIMIT = 15;

/**
 * Prompt da sessao (soul + grupo: estavel, vale para todos do canal) e texto de
 * cada turno (quem fala + o que o bot sabe dela + conversa recente).
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
		const { group } = this.memories.familiar("", channelId);
		return [this.souls.bodyFor(channelId), groupMemoryText(group)].filter(Boolean).join("\n\n");
	}

	turnText(turn: Turn): string {
		const { mine } = this.memories.familiar(turn.authorId, turn.channelId);
		const recent = this.messages
			.sinceLastBotMessage(turn.channelId, RECENT_LIMIT + 1)
			.filter((m) => m.messageId !== turn.messageId)
			.slice(-RECENT_LIMIT);
		return turnText({ ...turn, mine, recent });
	}
}
