import { describe, expect, it } from "bun:test";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { Persona } from "./persona.ts";

describe("Persona.systemPromptFor", () => {
	it("soul do canal + familiaridade da pessoa, separadas por linha em branco", () => {
		const souls = new FakeSoulStore();
		souls.ensureSeed("sou o elmatadore");
		const memories = new FakeMemoryStore();
		memories.commit(
			"c1",
			{
				summary: "",
				memories: [{ key: "a", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" }],
				episodes: [],
			},
			1,
		);
		expect(new Persona(souls, memories).systemPromptFor("c1", "u1")).toBe(
			"sou o elmatadore\n\n[memória do grupo e suas preferências]\n- [sua] (preference) ama Terraria",
		);
	});

	it("sem familiaridade fica so a soul; sem nada, vazio", () => {
		const souls = new FakeSoulStore();
		const memories = new FakeMemoryStore();
		expect(new Persona(souls, memories).systemPromptFor("c1", "u1")).toBe("");
		souls.ensureSeed("sou o elmatadore");
		expect(new Persona(souls, memories).systemPromptFor("c1", "u1")).toBe("sou o elmatadore");
	});
});
