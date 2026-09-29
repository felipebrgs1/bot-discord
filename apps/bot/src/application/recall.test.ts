import { describe, expect, it } from "bun:test";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { Recall } from "./recall.ts";

function setup() {
	const messages = new FakeMessageStore();
	const memories = new FakeMemoryStore();
	return { messages, memories, recall: new Recall(messages, memories) };
}

describe("Recall.searchHistory", () => {
	it("trecho com autor, data curta e contexto indentado", () => {
		const { messages, recall } = setup();
		messages.append({ channelId: "c1", authorId: "u1", authorName: "ana", messageId: "m1", body: "Terraria hoje?", createdAt: "2026-09-20T10:00:00.000Z" });
		messages.append({ channelId: "c1", authorId: "u2", authorName: "bob", messageId: "m2", body: "bora", createdAt: "2026-09-20T10:01:00.000Z" });
		expect(recall.searchHistory({ channelId: "c1", query: "Terraria" })).toBe(
			"• ana (2026-09-20 10:00): Terraria hoje?\n   │ bob: bora",
		);
	});

	it("limite fica entre 1 e 10 (padrao 5)", () => {
		const { messages, recall } = setup();
		for (let i = 0; i < 12; i++) {
			messages.append({ channelId: "c1", authorId: "u1", authorName: "ana", messageId: `m${i}`, body: `msg ${i}` });
		}
		const count = (limit?: number) => (recall.searchHistory({ channelId: "c1", limit }).match(/^• /gm) ?? []).length;
		expect(count()).toBe(5);
		expect(count(50)).toBe(10);
		expect(count(0)).toBe(1);
	});

	it("nada encontrado avisa", () => {
		expect(setup().recall.searchHistory({ channelId: "c1", query: "zzz" })).toBe("(nada encontrado no histórico)");
	});
});

describe("Recall.searchMemories", () => {
	it("lista com escopo, pessoa, tipo e chave", () => {
		const { memories, recall } = setup();
		memories.commit(
			"c1",
			{
				summary: "",
				memories: [{ key: "jogo", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" }],
				forget: [],
				confirm: [],
				episodes: [],
			},
			1,
		);
		expect(recall.searchMemories("c1", "Terraria")).toBe("• [user/u1] (preference) ama Terraria — chave jogo");
	});

	it("query vazia e erro; nada achado avisa", () => {
		const { recall } = setup();
		expect(recall.searchMemories("c1", "  ")).toBe("erro: query vazia");
		expect(recall.searchMemories("c1", "Terraria")).toBe("(nada nas memórias sobre isso)");
	});
});
