import type { SubAgents, SubTask } from "../../application/ports/sub-agents.ts";

/** Registra tarefas; a resposta vem de `answer` (padrao: eco do texto). */
export class FakeSubAgents implements SubAgents {
	readonly tasks: SubTask[] = [];
	answer: (task: SubTask) => Promise<string> = async (task) => `eco: ${task.text}`;

	async run(task: SubTask): Promise<string> {
		this.tasks.push(task);
		return this.answer(task);
	}
}
