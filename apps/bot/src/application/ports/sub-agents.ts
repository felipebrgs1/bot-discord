import type { ToolStep } from "./chat-agent.ts";

/** Uma tarefa para um agente efemero, sem a persona e sem historico. */
export interface SubTask {
	/** Prompt de sistema do agente. */
	instructions: string;
	text: string;
	/** Com as tools do bot (nunca as da maquina) ou sem nenhuma. */
	tools: boolean;
	/** Conversa de onde veio: escopo das tools de historico e memoria. */
	conversationId: string;
	onToolStep?: (step: ToolStep) => void;
}

/** Agentes descartaveis: cada run cria um, pergunta e descarta. */
export interface SubAgents {
	run(task: SubTask): Promise<string>;
}
