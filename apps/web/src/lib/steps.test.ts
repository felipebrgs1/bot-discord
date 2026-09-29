import { describe, expect, it } from "bun:test";
import type { ChatStep } from "@elmatadore/api";
import { groupSteps } from "./steps.ts";

const step = (tool: string, agent?: number): ChatStep => ({
	tool,
	args: "{}",
	output: "",
	duration_ms: 0,
	...(agent === undefined ? {} : { agent }),
});

describe("groupSteps", () => {
	it("sem swarm: um grupo so, sem rotulo", () => {
		expect(groupSteps([step("a"), step("b")])).toEqual([{ label: "", steps: [step("a"), step("b")] }]);
	});

	it("swarm: um grupo por agente em ordem e a resposta final por ultimo", () => {
		const groups = groupSteps([step("x", 2), step("y", 1), step("z", 2), step("final")]);
		expect(groups.map((g) => [g.agent, g.label, g.steps.map((s) => s.tool)])).toEqual([
			[1, "agente 1", ["y"]],
			[2, "agente 2", ["x", "z"]],
			[undefined, "resposta", ["final"]],
		]);
	});

	it("sem passos: nenhum grupo", () => {
		expect(groupSteps([])).toEqual([]);
	});
});
