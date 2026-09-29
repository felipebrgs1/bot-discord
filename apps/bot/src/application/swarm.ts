/**
 * Swarm: planejador sem tools divide o pedido (ate 4 tarefas) e cada tarefa
 * roda num worker com as tools do bot, todos ao mesmo tempo.
 */

import { parsePlan, SWARM_PLANNER_PROMPT, SWARM_WORKER_PROMPT, type SwarmResult } from "../domain/swarm.ts";
import type { ToolStep } from "./ports/chat-agent.ts";
import type { SubAgents } from "./ports/sub-agents.ts";

export class Swarm {
	private readonly agents: SubAgents;

	constructor(agents: SubAgents) {
		this.agents = agents;
	}

	/** Resultado por tarefa, na ordem do plano; `onStep` recebe o agente (1..4). */
	async run(
		conversationId: string,
		request: string,
		onStep: (agent: number, step: ToolStep) => void,
	): Promise<SwarmResult[]> {
		const plan = parsePlan(
			await this.agents.run({ instructions: SWARM_PLANNER_PROMPT, text: request, tools: false, conversationId }),
		);
		// parsePlan limita a 4: Promise.all ja e o teto de concorrencia.
		return Promise.all(
			plan.map(async (task, i): Promise<SwarmResult> => {
				try {
					const output = await this.agents.run({
						instructions: SWARM_WORKER_PROMPT,
						text: task,
						tools: true,
						conversationId,
						onToolStep: (step) => onStep(i + 1, step),
					});
					return { task, output };
				} catch (err) {
					return { task, error: err instanceof Error ? err.message : String(err) };
				}
			}),
		);
	}
}
