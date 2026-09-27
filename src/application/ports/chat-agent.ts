import type { ImageData } from "../../domain/image.ts";
import type { Role } from "../../domain/roles.ts";

/** Uma tool que o agente usou durante a resposta (painel mostra passo a passo). */
export interface ToolStep {
	tool: string;
	args: string;
	output: string;
	durationMs: number;
}

export interface ChatRequest {
	/** Conversa: canal do Discord ou "web:<sessao>". */
	channelId: string;
	authorId: string;
	role: Role;
	text: string;
	images: readonly ImageData[];
	source?: "discord" | "web";
	/** Prompt extra (soul + familiaridade); vale ao criar a sessao da conversa. */
	systemPrompt?: string;
	onToolStep?: (step: ToolStep) => void;
}

/** O agente que conversa (hoje: sessao do pi por conversa+papel). */
export interface ChatAgent {
	ask(request: ChatRequest): Promise<string>;
}

/** Sessoes vivas do agente, por conversa. */
export interface ChatSessions {
	conversations(): string[];
	/** Derruba as sessoes da conversa (a proxima pergunta cria de novo). */
	forget(conversationId: string): void;
}
