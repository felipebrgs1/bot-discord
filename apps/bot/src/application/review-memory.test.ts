import { describe, expect, it } from "bun:test";
import { FakeLogger } from "@/test-support/fakes/logger.ts";
import { FakeMemoryStore } from "@/test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "@/test-support/fakes/message-store.ts";
import { AgentMemory } from "./agent-memory.ts";
import { ReviewMemory } from "./review-memory.ts";

function setup(answer: (prompt: string) => Promise<unknown>) {
	const messages = new FakeMessageStore();
	const store = new FakeMemoryStore();
	const logger = new FakeLogger();
	const prompts: string[] = [];
	const review = new ReviewMemory({
		messages,
		store,
		memory: new AgentMemory(store),
		logger,
		extractor: {
			complete: (prompt) => {
				prompts.push(prompt);
				return answer(prompt);
			},
		},
	});
	for (const [i, [authorId, body]] of [
		["u1", "meu jogo favorito é Terraria"],
		["u2", "massa, o meu é Stardew"],
		["u1", "kkk"],
	].entries()) {
		messages.append({ channelId: "c1", authorId: authorId ?? "", authorName: `nome-${authorId}`, messageId: `m${i}`, body: body ?? "" });
	}
	return { messages, store, logger, prompts, review };
}

const terraria = async () => ({ edits: [{ target: "user", person_id: "u1", action: "add", content: "ama Terraria" }] });

describe("ReviewMemory.channel", () => {
	it("mostra lote e blocos ao modelo, aplica as edicoes e avanca o cursor", async () => {
		const { store, prompts, review } = setup(terraria);
		store.write({ scope: "user", ownerId: "u2" }, ["joga Stardew"], "seed");
		expect(await review.channel("c1")).toEqual({ reviewed: true, edits: 1 });
		expect(prompts[0]).toContain("meu jogo favorito é Terraria");
		expect(prompts[0]).toContain("memória de nome-u2 (person_id u2)");
		expect(prompts[0]).toContain("- joga Stardew");
		expect(store.read({ scope: "user", ownerId: "u1" })).toEqual(["ama Terraria"]);
		expect(store.versions("user", "u1").map((v) => v.reason)).toEqual(["revisão: add"]);
		expect(store.cursor("c1")).toBe(3);
	});

	it("nao escreve memoria de quem nao falou no lote (nem do bot)", async () => {
		const { messages, store, review } = setup(async () => ({
			edits: [{ target: "user", person_id: "b1", action: "add", content: "o bot torce pro Timão" }],
		}));
		messages.append({ channelId: "c1", authorId: "b1", authorName: "bot", messageId: "mb", body: "sou do Timão", fromBot: true });
		await review.channel("c1");
		expect(store.read({ scope: "user", ownerId: "b1" })).toEqual([]);
	});

	it("edicao recusada (teto, trecho) e pulada e logada; o resto vale", async () => {
		const { store, logger, review } = setup(async () => ({
			edits: [
				{ target: "group", action: "remove", old_text: "nao existe" },
				{ target: "group", action: "add", content: "sextou é sagrado" },
			],
		}));
		expect(await review.channel("c1")).toEqual({ reviewed: true, edits: 1 });
		expect(store.read({ scope: "group", ownerId: "c1" })).toEqual(["sextou é sagrado"]);
		expect(logger.lines.some((l) => l.includes("nao existe"))).toBe(true);
	});

	it("sem mensagens novas suficientes nao chama o modelo", async () => {
		const { prompts, review } = setup(terraria);
		await review.channel("c1");
		expect(await review.channel("c1")).toEqual({ reviewed: false, edits: 0 });
		expect(prompts).toHaveLength(1);
	});

	it("falha do modelo nao avanca o cursor", async () => {
		const { store, review } = setup(async () => {
			throw new Error("timeout");
		});
		expect(await review.channel("c1")).toEqual({ reviewed: false, edits: 0 });
		expect(store.cursor("c1")).toBe(0);
	});
});

describe("ReviewMemory.all", () => {
	it("passa por todos os canais e soma", async () => {
		const { review } = setup(terraria);
		expect(await review.all(["c1", "c2"])).toEqual({ channels: 1, edits: 1 });
	});
});
