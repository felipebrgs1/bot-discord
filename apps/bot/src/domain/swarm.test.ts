import { describe, expect, it } from "bun:test";
import { canSwarm, MAX_SWARM_AGENTS, parsePlan, parseSwarmCommand, synthesisText } from "./swarm.ts";

describe("parseSwarmCommand", () => {
	it("extrai o pedido depois de /swarm", () => {
		expect(parseSwarmCommand("/swarm compara os 3 jogos")).toBe("compara os 3 jogos");
		expect(parseSwarmCommand("  /swarm\n  linha 1\nlinha 2  ")).toBe("linha 1\nlinha 2");
	});

	it("ignora texto que nao e o comando", () => {
		expect(parseSwarmCommand("oi")).toBeUndefined();
		expect(parseSwarmCommand("/swarmx pedido")).toBeUndefined();
		expect(parseSwarmCommand("fala do /swarm pedido")).toBeUndefined();
	});

	it("comando sem pedido nao conta", () => {
		expect(parseSwarmCommand("/swarm")).toBeUndefined();
		expect(parseSwarmCommand("/swarm   ")).toBeUndefined();
	});
});

describe("canSwarm", () => {
	it("so admin", () => {
		expect(canSwarm("admin")).toBe(true);
		expect(canSwarm("user")).toBe(false);
	});
});

describe("parsePlan", () => {
	it("le as tarefas do JSON", () => {
		expect(parsePlan('{"tasks": ["a", "b"]}')).toEqual(["a", "b"]);
	});

	it("aceita JSON em bloco de codigo ou com texto em volta", () => {
		expect(parsePlan('aqui:\n```json\n{"tasks": ["a"]}\n```')).toEqual(["a"]);
	});

	it("descarta tarefas vazias ou que nao sao texto", () => {
		expect(parsePlan('{"tasks": ["  a  ", "", 3, null, "b"]}')).toEqual(["a", "b"]);
	});

	it(`corta em ${MAX_SWARM_AGENTS} tarefas`, () => {
		expect(parsePlan('{"tasks": ["1", "2", "3", "4", "5", "6"]}')).toEqual(["1", "2", "3", "4"]);
	});

	it("lanca se nao ha nenhuma tarefa valida", () => {
		expect(() => parsePlan("nao sei")).toThrow("plano do swarm inválido");
		expect(() => parsePlan('{"tasks": []}')).toThrow("plano do swarm inválido");
		expect(() => parsePlan('{"tasks": "a"}')).toThrow("plano do swarm inválido");
	});
});

describe("synthesisText", () => {
	it("junta o pedido e o resultado de cada agente, com falhas marcadas", () => {
		const text = synthesisText("compara A e B", [
			{ task: "pesquisa A", output: "A custa 10" },
			{ task: "pesquisa B", error: "timeout" },
		]);
		expect(text).toContain("compara A e B");
		expect(text).toContain("### Agente 1: pesquisa A\nA custa 10");
		expect(text).toContain("### Agente 2: pesquisa B\n(falhou: timeout)");
	});
});
