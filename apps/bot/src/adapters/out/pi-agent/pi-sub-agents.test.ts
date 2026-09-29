import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ToolStep } from "../../../application/ports/chat-agent.ts";
import type { SubTask } from "../../../application/ports/sub-agents.ts";
import { FakeMetrics } from "../../../test-support/fakes/metrics.ts";
import { PiSubAgents, type WorkerFactory } from "./pi-sub-agents.ts";

interface Created {
	conversationId: string;
	instructions: string;
	tools: boolean;
	prompts: string[];
	listeners: ((e: unknown) => void)[];
	disposed: boolean;
}

function setup(behavior: (c: Created) => Promise<void> = async () => undefined) {
	const created: Created[] = [];
	const bySession = new Map<AgentSession, Created>();
	const factory: WorkerFactory = {
		async create(conversationId, instructions, tools) {
			const c: Created = { conversationId, instructions, tools, prompts: [], listeners: [], disposed: false };
			created.push(c);
			let output = 0;
			const session = {
				model: { id: "modelo-real", provider: "prov" },
				prompt: async (text: string) => {
					c.prompts.push(text);
					output = 40;
					await behavior(c);
				},
				waitForIdle: async () => undefined,
				getLastAssistantText: () => `relatorio: ${c.prompts[0]}`,
				getSessionStats: () => ({ tokens: { input: 10, output, cacheRead: 0, cacheWrite: 0 }, cost: 0 }),
				subscribe: (cb: (e: unknown) => void) => {
					c.listeners.push(cb);
					return () => c.listeners.splice(c.listeners.indexOf(cb), 1);
				},
				dispose: () => undefined,
			} as unknown as AgentSession;
			bySession.set(session, c);
			return session;
		},
		dispose(session) {
			const c = bySession.get(session);
			if (c) c.disposed = true;
		},
	};
	let now = 0;
	const metrics = new FakeMetrics();
	const agents = new PiSubAgents({ factory, metrics, model: () => "modelo-config", now: () => (now += 100) });
	return { created, metrics, agents };
}

const task = (over: Partial<SubTask> = {}): SubTask => ({
	instructions: "voce e worker",
	text: "pesquisa A",
	tools: true,
	conversationId: "web:s1",
	...over,
});

describe("PiSubAgents", () => {
	it("cria um agente novo por tarefa com instrucoes e tools pedidas, e descarta no fim", async () => {
		const { created, agents } = setup();
		expect(await agents.run(task())).toBe("relatorio: pesquisa A");
		expect(await agents.run(task({ tools: false, text: "planeja" }))).toBe("relatorio: planeja");
		expect(created.map((c) => [c.conversationId, c.instructions, c.tools, c.disposed])).toEqual([
			["web:s1", "voce e worker", true, true],
			["web:s1", "voce e worker", false, true],
		]);
	});

	it("registra o turno como swarm do painel", async () => {
		const { metrics, agents } = setup();
		await agents.run(task());
		expect(metrics.turns[0]).toMatchObject({
			operation: "swarm",
			source: "web",
			status: "success",
			model: "modelo-real",
			outputTokens: 40,
			latencyMs: 100,
		});
	});

	it("erro do provedor registra falha, descarta o agente e propaga", async () => {
		const { created, metrics, agents } = setup(async () => {
			throw new Error("rate limit");
		});
		await expect(agents.run(task())).rejects.toThrow("rate limit");
		expect(metrics.turns[0]?.status).toBe("error");
		expect(created[0]?.disposed).toBe(true);
	});

	it("repassa os passos de tool e para de escutar no fim", async () => {
		const steps: ToolStep[] = [];
		const { created, agents } = setup(async (c) => {
			for (const l of c.listeners) {
				l({ type: "tool_execution_start", toolCallId: "t1", toolName: "web_fetch", args: { url: "u" } });
				l({ type: "tool_execution_end", toolCallId: "t1", toolName: "web_fetch", result: { content: [{ type: "text", text: "pagina" }] } });
			}
		});
		await agents.run(task({ onToolStep: (s) => void steps.push(s) }));
		expect(steps.map((s) => [s.tool, s.output])).toEqual([["web_fetch", "pagina"]]);
		expect(created[0]?.listeners).toEqual([]);
	});
});
