/** /gerar: um sub-agente reescreve o pedido num prompt de imagem com o contexto do canal. */

import { IMAGE_PROMPT_INSTRUCTIONS } from "@/domain/image.ts";
import type { Logger } from "./ports/logger.ts";
import type { SubAgents } from "./ports/sub-agents.ts";
import type { Turn } from "./persona.ts";

export interface ImagePromptDeps {
	agents: SubAgents;
	logger: Logger;
	/** Soul + memoria do grupo (Persona). */
	systemPromptFor: (channelId: string) => string;
	/** Quem pediu, o que o bot sabe dela e conversa recente (Persona). */
	turnText: (turn: Turn) => string;
}

export class ImagePromptWriter {
	private readonly deps: ImagePromptDeps;

	constructor(deps: ImagePromptDeps) {
		this.deps = deps;
	}

	/** Prompt pronto; se o sub-agente falhar ou vier vazio, o pedido original. */
	async write(turn: Turn): Promise<string> {
		const { agents, logger, systemPromptFor, turnText } = this.deps;
		try {
			const prompt = await agents.run({
				instructions: [IMAGE_PROMPT_INSTRUCTIONS, systemPromptFor(turn.channelId)].filter(Boolean).join("\n\n"),
				text: turnText(turn),
				tools: false,
				conversationId: turn.channelId,
			});
			return prompt.trim() || turn.text;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logger.error(`image_prompt_failed canal=${turn.channelId} erro=${message.slice(0, 500)}`);
			return turn.text;
		}
	}
}
