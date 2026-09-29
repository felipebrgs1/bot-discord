import type { ChatStep } from "@elmatadore/api";

export interface StepGroup {
	/** Vazio quando nao houve swarm (so o agente da conversa). */
	label: string;
	/** Worker do /swarm; ausente no grupo do agente da conversa. */
	agent?: number;
	steps: ChatStep[];
}

/** Passos por worker do /swarm (1..4, em ordem) e os do agente da conversa por ultimo. */
export function groupSteps(steps: ChatStep[]): StepGroup[] {
	const main = steps.filter((s) => s.agent === undefined);
	const agents = [...new Set(steps.flatMap((s) => (s.agent === undefined ? [] : [s.agent])))].sort((a, b) => a - b);
	if (agents.length === 0) return main.length > 0 ? [{ label: "", steps: main }] : [];
	const groups = agents.map((n) => ({ label: `agente ${n}`, agent: n, steps: steps.filter((s) => s.agent === n) }));
	return main.length > 0 ? [...groups, { label: "resposta", steps: main }] : groups;
}
