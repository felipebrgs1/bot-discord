import { familiarityText } from "../domain/memory.ts";
import type { MemoryStore } from "./ports/memory-store.ts";
import type { SoulStore } from "./ports/soul-store.ts";

/** Prompt extra de cada resposta: soul do canal + o que o bot sabe da pessoa e do grupo. */
export class Persona {
	private readonly souls: SoulStore;
	private readonly memories: MemoryStore;

	constructor(souls: SoulStore, memories: MemoryStore) {
		this.souls = souls;
		this.memories = memories;
	}

	systemPromptFor(channelId: string, personId: string): string {
		const { mine, group } = this.memories.familiar(personId, channelId);
		return [this.souls.bodyFor(channelId), familiarityText(mine, group)].filter(Boolean).join("\n\n");
	}
}
