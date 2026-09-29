import { describe, expect, it } from "bun:test";
import { SWARM_PLANNER_PROMPT, SWARM_WORKER_PROMPT } from "../domain/swarm.ts";
import { FakeSubAgents } from "../test-support/fakes/sub-agents.ts";
import type { ToolStep } from "./ports/chat-agent.ts";
import { Swarm } from "./swarm.ts";

function planning(tasks: string[]) {
	const agents = new FakeSubAgents();
	agents.answer = async (task) => {
		if (task.instructions === SWARM_PLANNER_PROMPT) return JSON.stringify({ tasks });
		task.onToolStep?.({ tool: "web_search", args: "{}", output: task.text, durationMs: 1 });
		return `feito: ${task.text}`;
	};
	return agents;
}

describe("Swarm", () => {
	it("planeja sem tools e roda cada tarefa num worker com tools", async () => {
		const agents = planning(["A", "B"]);
		const results = await new Swarm(agents).run("web:s1", "compara A e B", () => undefined);
		expect(results).toEqual([
			{ task: "A", output: "feito: A" },
			{ task: "B", output: "feito: B" },
		]);
		expect(agents.tasks.map((t) => [t.instructions, t.text, t.tools, t.conversationId])).toEqual([
			[SWARM_PLANNER_PROMPT, "compara A e B", false, "web:s1"],
			[SWARM_WORKER_PROMPT, "A", true, "web:s1"],
			[SWARM_WORKER_PROMPT, "B", true, "web:s1"],
		]);
	});

	it("roda os workers ao mesmo tempo", async () => {
		const agents = planning(["A", "B", "C"]);
		let running = 0;
		let peak = 0;
		const plan = agents.answer;
		agents.answer = async (task) => {
			if (!task.tools) return plan(task);
			running++;
			peak = Math.max(peak, running);
			await Promise.resolve();
			running--;
			return "ok";
		};
		await new Swarm(agents).run("web:s1", "pedido", () => undefined);
		expect(peak).toBe(3);
	});

	it("marca cada passo com o numero do agente", async () => {
		const steps: [number, ToolStep][] = [];
		await new Swarm(planning(["A", "B"])).run("web:s1", "pedido", (agent, step) => void steps.push([agent, step]));
		expect(steps.map(([agent, step]) => [agent, step.output])).toEqual([
			[1, "A"],
			[2, "B"],
		]);
	});

	it("falha de um worker vira erro no resultado sem derrubar os outros", async () => {
		const agents = planning(["A", "B"]);
		const plan = agents.answer;
		agents.answer = async (task) => {
			if (task.text === "A") throw new Error("timeout");
			return plan(task);
		};
		const results = await new Swarm(agents).run("web:s1", "pedido", () => undefined);
		expect(results).toEqual([
			{ task: "A", error: "timeout" },
			{ task: "B", output: "feito: B" },
		]);
	});

	it("plano invalido interrompe antes dos workers", async () => {
		const agents = new FakeSubAgents();
		agents.answer = async () => "sei la";
		await expect(new Swarm(agents).run("web:s1", "pedido", () => undefined)).rejects.toThrow("plano do swarm inválido");
		expect(agents.tasks).toHaveLength(1);
	});
});
