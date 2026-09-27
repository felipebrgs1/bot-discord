import type { ImageData } from "../../domain/image.ts";
import type { Role } from "../../domain/roles.ts";

export interface ChatRequest {
	channelId: string;
	authorId: string;
	role: Role;
	text: string;
	images: readonly ImageData[];
}

/** O agente que conversa (hoje: sessao do pi por canal+papel). */
export interface ChatAgent {
	ask(request: ChatRequest): Promise<string>;
}
