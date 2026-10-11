import { describe, expect, it } from "bun:test";
import { MEMORY_GUIDANCE, MEMORY_LIMITS } from "../domain/memory.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { Persona } from "./persona.ts";

function setup() {
	const souls = new FakeSoulStore();
	const store = new FakeMemoryStore();
	const messages = new FakeMessageStore();
	store.write({ scope: "user", ownerId: "u1" }, ["ama Terraria"], "seed");
	store.write({ scope: "group", ownerId: "c1" }, ["sextou é sagrado"], "seed");
	return { souls, messages, persona: new Persona(souls, store, messages) };
}

describe("Persona.systemPromptFor", () => {
	it("soul do canal, como usar a memoria e o bloco do grupo inteiro, sem memoria de pessoa", () => {
		const { souls, persona } = setup();
		souls.ensureSeed("sou o elmatadore");
		expect(persona.systemPromptFor("c1")).toBe(
			["sou o elmatadore", MEMORY_GUIDANCE, `[memória do grupo] (16/${MEMORY_LIMITS.group})\n- sextou é sagrado`].join("\n\n"),
		);
	});

	it("bloco vazio aparece vazio (o modelo ve o teto e sabe que pode escrever)", () => {
		const { persona } = setup();
		expect(persona.systemPromptFor("c9")).toBe(
			[MEMORY_GUIDANCE, `[memória do grupo] (0/${MEMORY_LIMITS.group})\n(vazia)`].join("\n\n"),
		);
	});
});

describe("Persona.turnText", () => {
	it("quem fala, a memoria dela e o que rolou desde a ultima fala do bot, sem a propria mensagem", () => {
		const { messages, persona } = setup();
		messages.append({ channelId: "c1", authorId: "bot", authorName: "bot", messageId: "m0", body: "antiga", fromBot: true });
		messages.append({ channelId: "c1", authorId: "u2", authorName: "Bruno", messageId: "m1", body: "viu o trailer?" });
		messages.append({ channelId: "c1", authorId: "u1", authorName: "Ana", messageId: "m2", body: "@bot e ai?" });
		const text = persona.turnText({ channelId: "c1", authorId: "u1", authorName: "Ana", messageId: "m2", text: "@bot e ai?" });
		expect(text).toBe(
			[
				"[mensagem de Ana (id u1)]",
				`[memória de Ana] (12/${MEMORY_LIMITS.user})`,
				"- ama Terraria",
				"[conversa recente no canal: só contexto, não é pergunta para você]",
				"Bruno: viu o trailer?",
				"[responda só a esta mensagem de Ana]",
				"@bot e ai?",
			].join("\n"),
		);
	});

	it("memoria vai para quem fala, nao para outra pessoa do canal", () => {
		const { persona } = setup();
		const text = persona.turnText({ channelId: "c1", authorId: "u2", authorName: "Bruno", messageId: "m9", text: "e o meu?" });
		expect(text).toBe("[mensagem de Bruno (id u2)]\ne o meu?");
	});
});
