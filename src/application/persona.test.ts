import { describe, expect, it } from "bun:test";
import type { ExtractedMemory } from "../domain/memory.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { Persona } from "./persona.ts";

function setup(...memories: ExtractedMemory[]) {
	const souls = new FakeSoulStore();
	const store = new FakeMemoryStore();
	const messages = new FakeMessageStore();
	store.commit("c1", { summary: "", memories, episodes: [] }, 1);
	return { souls, messages, persona: new Persona(souls, store, messages) };
}

const anaPref: ExtractedMemory = { key: "a", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" };
const culture: ExtractedMemory = { key: "c", kind: "culture", scope: "group", personId: "", content: "sextou é sagrado" };

describe("Persona.systemPromptFor", () => {
	it("soul do canal + memoria do grupo, sem memoria de pessoa", () => {
		const { souls, persona } = setup(anaPref, culture);
		souls.ensureSeed("sou o elmatadore");
		expect(persona.systemPromptFor("c1")).toBe("sou o elmatadore\n\n[memória do grupo]\n- (culture) sextou é sagrado");
	});

	it("sem memoria fica so a soul; sem nada, vazio", () => {
		const { souls, persona } = setup();
		expect(persona.systemPromptFor("c1")).toBe("");
		souls.ensureSeed("sou o elmatadore");
		expect(persona.systemPromptFor("c1")).toBe("sou o elmatadore");
	});
});

describe("Persona.turnText", () => {
	it("diz quem fala, o que lembra dela e o que rolou desde a ultima fala do bot, sem a propria mensagem", () => {
		const { messages, persona } = setup(anaPref);
		messages.append({ channelId: "c1", authorId: "bot", authorName: "bot", messageId: "m0", body: "antiga", fromBot: true });
		messages.append({ channelId: "c1", authorId: "u2", authorName: "Bruno", messageId: "m1", body: "viu o trailer?" });
		messages.append({ channelId: "c1", authorId: "u1", authorName: "Ana", messageId: "m2", body: "@bot e ai?" });
		const text = persona.turnText({ channelId: "c1", authorId: "u1", authorName: "Ana", messageId: "m2", text: "@bot e ai?" });
		expect(text).toBe(
			[
				"[mensagem de Ana (id u1)]",
				"[o que você lembra de Ana]",
				"- (preference) ama Terraria",
				"[conversa no canal desde sua última fala]",
				"Bruno: viu o trailer?",
				"---",
				"@bot e ai?",
			].join("\n"),
		);
	});

	it("memorias vao para quem fala, nao para outra pessoa do canal", () => {
		const { persona } = setup(anaPref);
		const text = persona.turnText({ channelId: "c1", authorId: "u2", authorName: "Bruno", messageId: "m9", text: "e o meu?" });
		expect(text).toBe("[mensagem de Bruno (id u2)]\ne o meu?");
	});
});
