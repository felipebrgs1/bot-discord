/** SubAgents sobre sessoes efemeras do pi: uma por tarefa, descartada no fim. */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { MetricsSink } from "../../../application/ports/metrics.ts";
import type { SubAgents, SubTask } from "../../../application/ports/sub-agents.ts";
import type { TurnReport } from "../../../domain/turn.ts";
import { statsOf, turnReport, watchTools } from "./pi-chat-agent.ts";
import { askSession } from "./session-pool.ts";

export interface WorkerFactory {
	/** Sessao sem persona: `instructions` e o prompt; `tools` liga as do bot. */
	create(conversationId: string, instructions: string, tools: boolean): Promise<AgentSession>;
	dispose(session: AgentSession): void;
}

export interface PiSubAgentsOptions {
	factory: WorkerFactory;
	metrics: MetricsSink;
	/** Modelo pedido no config (fallback da metrica). */
	model: () => string;
	now?: () => number;
}

export class PiSubAgents implements SubAgents {
	private readonly opts: PiSubAgentsOptions;
	private readonly now: () => number;

	constructor(opts: PiSubAgentsOptions) {
		this.opts = opts;
		this.now = opts.now ?? Date.now;
	}

	async run(task: SubTask): Promise<string> {
		const { factory, metrics, model } = this.opts;
		const session = await factory.create(task.conversationId, task.instructions, task.tools);
		const stop = task.onToolStep ? watchTools(session, task.onToolStep, this.now) : () => undefined;
		const before = statsOf(session);
		const started = this.now();
		const report = (status: TurnReport["status"]) =>
			metrics.record(
				turnReport(session, before, { operation: "swarm", source: "web", status, latencyMs: this.now() - started }, model()),
			);
		try {
			const text = await askSession(session, task.text);
			report("success");
			return text;
		} catch (err) {
			report("error");
			throw err;
		} finally {
			try {
				stop();
			} catch {
				/* ignora */
			}
			factory.dispose(session);
		}
	}
}
