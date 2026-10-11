import { describe, expect, it } from "bun:test";
import { MEMORY_LIMITS } from "../domain/memory.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { AgentMemory } from "./agent-memory.ts";

const group = { scope: "group" as const, ownerId: "c1" };
const ana = { scope: "user" as const, ownerId: "u1" };

function setup() {
	const store = new FakeMemoryStore();
	return { store, memory: new AgentMemory(store) };
}

describe("AgentMemory.edit", () => {
	it("grava o bloco novo com o motivo", () => {
		const { store, memory } = setup();
		expect(memory.edit(ana, { action: "add", content: "odeia spoiler" }, "tool: add")).toEqual({
			ok: true,
			entries: ["odeia spoiler"],
		});
		expect(store.read(ana)).toEqual(["odeia spoiler"]);
		expect(store.versions("user", "u1").map((v) => v.reason)).toEqual(["tool: add"]);
	});

	it("edicao com erro nao grava nada", () => {
		const { store, memory } = setup();
		expect(memory.edit(ana, { action: "remove", oldText: "x" }, "tool").ok).toBe(false);
		expect(store.versionRows).toEqual([]);
	});

	it("usa o teto do escopo", () => {
		const { memory } = setup();
		const big = "a".repeat(MEMORY_LIMITS.user + 1);
		expect(memory.edit(ana, { action: "add", content: big }, "tool").ok).toBe(false);
		expect(memory.edit(group, { action: "add", content: big }, "tool").ok).toBe(true);
	});
});

describe("AgentMemory.forTool", () => {
	it("sucesso devolve o bloco como ficou", () => {
		const { memory } = setup();
		expect(memory.forTool(group, { action: "add", content: "sextou é sagrado" })).toBe(
			`ok. [memória do grupo] (16/${MEMORY_LIMITS.group})\n- sextou é sagrado`,
		);
	});

	it("erro vem com o bloco atual, para o modelo consolidar", () => {
		const { store, memory } = setup();
		store.write(ana, ["joga LoL"], "seed");
		expect(memory.forTool(ana, { action: "remove", oldText: "minecraft" })).toBe(
			`erro: nenhuma entrada contém "minecraft"\n[memória da pessoa u1] (8/${MEMORY_LIMITS.user})\n- joga LoL`,
		);
	});
});

describe("AgentMemory.replace", () => {
	it("troca o bloco inteiro respeitando o teto", () => {
		const { store, memory } = setup();
		expect(memory.replace(ana, ["joga LoL", " "], "painel")).toEqual({ ok: true, entries: ["joga LoL"] });
		expect(store.read(ana)).toEqual(["joga LoL"]);
		expect(memory.replace(ana, ["a".repeat(MEMORY_LIMITS.user + 1)], "painel").ok).toBe(false);
		expect(store.read(ana)).toEqual(["joga LoL"]);
	});
});
