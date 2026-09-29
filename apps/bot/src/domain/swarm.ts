/**
 * Swarm: o admin pede `/swarm <pedido>` no painel; um planejador divide em ate
 * 4 tarefas, workers rodam em paralelo e o agente da conversa junta tudo.
 */

import type { Role } from "./roles.ts";

export const MAX_SWARM_AGENTS = 4;

/** Resultado de um worker: saida ou erro. */
export interface SwarmResult {
	task: string;
	output?: string;
	error?: string;
}

export const SWARM_PLANNER_PROMPT = `Você divide um pedido em tarefas independentes que agentes separados vão executar em paralelo, cada um com pesquisa web, leitura de páginas e busca no histórico e nas memórias do grupo.

Regras:
- De 1 a ${MAX_SWARM_AGENTS} tarefas. Use menos se o pedido for simples; 1 é válido.
- Cada tarefa é autocontida: o agente não vê o pedido original nem as outras tarefas.
- Não crie tarefa de juntar resultados; isso é feito depois.

Responda só com JSON, sem texto em volta: {"tasks": ["tarefa 1", "tarefa 2"]}`;

export const SWARM_WORKER_PROMPT = `Você é um agente executando uma parte de um pedido maior. Use as tools para cumprir só a sua tarefa.

Responda com um relatório objetivo em português: os fatos encontrados, as fontes (links) e o que não conseguiu achar. Sem saudação, sem conversa, sem perguntas.`;

/** Pedido do comando `/swarm`; undefined se o texto nao e o comando ou vem vazio. */
export function parseSwarmCommand(text: string): string | undefined {
	const match = /^\/swarm(?:\s+([\s\S]*))?$/.exec(text.trim());
	const request = match?.[1]?.trim();
	return request || undefined;
}

export function canSwarm(role: Role): boolean {
	return role === "admin";
}

/** Tarefas do JSON do planejador (tolera cerca de codigo e texto em volta). */
export function parsePlan(raw: string): string[] {
	const start = raw.indexOf("{");
	const end = raw.lastIndexOf("}");
	let tasks: unknown;
	try {
		tasks = (JSON.parse(raw.slice(start, end + 1)) as { tasks?: unknown }).tasks;
	} catch {
		tasks = undefined;
	}
	const valid = Array.isArray(tasks)
		? tasks.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
		: [];
	if (valid.length === 0) throw new Error(`plano do swarm inválido: ${raw.slice(0, 200)}`);
	return valid.slice(0, MAX_SWARM_AGENTS);
}

/** Texto do turno em que o agente da conversa junta os resultados. */
export function synthesisText(request: string, results: readonly SwarmResult[]): string {
	const parts = results.map(
		(r, i) => `### Agente ${i + 1}: ${r.task}\n${r.error === undefined ? (r.output ?? "") : `(falhou: ${r.error})`}`,
	);
	return [
		`Pedido (/swarm): ${request}`,
		`${results.length} agentes trabalharam em paralelo. Resultados:`,
		...parts,
		"Responda ao pedido juntando os resultados. Diga o que ficou sem resposta.",
	].join("\n\n");
}
