import type { ChatAgent, ChatRequest } from "../../application/ports/chat-agent.ts";

/** Registra pedidos; a resposta vem de `answer` (padrao: eco do texto). */
export class FakeChatAgent implements ChatAgent {
	readonly requests: ChatRequest[] = [];
	answer: (request: ChatRequest) => Promise<string> = async (request) => `eco: ${request.text}`;

	async ask(request: ChatRequest): Promise<string> {
		this.requests.push(request);
		return this.answer(request);
	}
}
