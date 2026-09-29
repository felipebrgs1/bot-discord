import { describe, expect, it } from "bun:test";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { ConsolidateMemory } from "./consolidate-memory.ts";

function setup(answer: (prompt: string) => Promise<unknown>) {
	const messages = new FakeMessageStore();
	const memories = new FakeMemoryStore();
	const logger = new FakeLogger();
	const prompts: string[] = [];
	const consolidate = new ConsolidateMemory({
		messages,
		memories,
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
		messages.append({ channelId: "c1", authorId: authorId ?? "", authorName: authorId ?? "", messageId: `m${i}`, body: body ?? "" });
	}
	return { messages, memories, logger, prompts, consolidate };
}

const terraria = async () => ({
	summary: "s",
	memories: [{ key: "jogo-favorito", kind: "preference", scope: "user", person_id: "u1", content: "ama Terraria" }],
	episodes: [],
});

describe("ConsolidateMemory.channel", () => {
	it("nao grava memoria de usuario atribuida ao bot", async () => {
		const { messages, memories, consolidate } = setup(async () => ({
			memories: [{ key: "time", kind: "fact", scope: "user", person_id: "b1", content: "o bot torce pro Timão" }],
		}));
		messages.append({ channelId: "c1", authorId: "b1", authorName: "bot", messageId: "mb", body: "sou do Timão", fromBot: true });
		await consolidate.channel("c1");
		expect(memories.listActive(10)).toEqual([]);
	});

	it("extrai do lote novo, grava e avanca o cursor ate a ultima mensagem", async () => {
		const { memories, prompts, consolidate } = setup(terraria);
		expect(await consolidate.channel("c1")).toEqual({ consolidated: true, memories: 1 });
		expect(prompts[0]).toContain("meu jogo favorito é Terraria");
		expect(memories.listActive(10).map((m) => m.content)).toEqual(["ama Terraria"]);
		expect(memories.cursor("c1")).toBe(3);
	});

	it("sem mensagens novas nao chama o modelo de novo", async () => {
		const { prompts, consolidate } = setup(terraria);
		await consolidate.channel("c1");
		expect(await consolidate.channel("c1")).toEqual({ consolidated: false, memories: 0 });
		expect(prompts).toHaveLength(1);
	});

	it("menos mensagens novas que o minimo espera", async () => {
		const { prompts, consolidate } = setup(terraria);
		expect((await consolidate.channel("c1", { minNew: 4 })).consolidated).toBe(false);
		expect(prompts).toHaveLength(0);
	});

	it("respeita o tamanho do lote", async () => {
		const { memories, consolidate } = setup(terraria);
		await consolidate.channel("c1", { batchSize: 2, minNew: 1 });
		expect(memories.cursor("c1")).toBe(2);
	});

	it("mostra ao extrator as memorias atuais do grupo e de quem falou no lote", async () => {
		const { memories, prompts, consolidate } = setup(terraria);
		memories.commit(
			"c0",
			{
				summary: "",
				memories: [
					{ key: "joga-lol", kind: "fact", scope: "user", personId: "u2", content: "joga LoL" },
					{ key: "de-fora", kind: "fact", scope: "user", personId: "u9", content: "de quem nao falou" },
				],
				forget: [],
				confirm: [],
				episodes: [],
			},
			0,
		);
		await consolidate.channel("c1");
		expect(prompts[0]).toContain("key=joga-lol scope=user person_id=u2 (fact): joga LoL");
		expect(prompts[0]).not.toContain("de quem nao falou");
	});

	it("forget do modelo suprime memoria conhecida de quem falou", async () => {
		const { memories, consolidate } = setup(async () => ({
			forget: [{ key: "joga-lol", scope: "user", person_id: "u2", reason: "largou" }],
		}));
		memories.commit(
			"c0",
			{
				summary: "",
				memories: [{ key: "joga-lol", kind: "fact", scope: "user", personId: "u2", content: "joga LoL" }],
				forget: [],
				confirm: [],
				episodes: [],
			},
			0,
		);
		await consolidate.channel("c1");
		expect(memories.listActive(10)).toEqual([]);
	});

	it("so aceita memoria individual de quem falou no lote", async () => {
		const { memories, consolidate } = setup(async () => ({
			memories: [{ key: "x", kind: "preference", scope: "user", person_id: "u9", content: "intruso" }],
		}));
		expect(await consolidate.channel("c1")).toEqual({ consolidated: true, memories: 0 });
		expect(memories.listActive(10)).toEqual([]);
	});

	it("falha do modelo nao avanca o cursor e vira aviso no log", async () => {
		const { memories, logger, consolidate } = setup(async () => {
			throw new Error("modelo caiu");
		});
		expect((await consolidate.channel("c1")).consolidated).toBe(false);
		expect(memories.cursor("c1")).toBe(0);
		expect(logger.lines.some((l) => l.startsWith("warn") && l.includes("modelo caiu"))).toBe(true);
	});
});

describe("ConsolidateMemory.all", () => {
	it("soma canais consolidados; erro de gravacao num canal nao para os outros", async () => {
		const { messages, memories, logger, consolidate } = setup(terraria);
		messages.append({ channelId: "c2", authorId: "u1", authorName: "u1", messageId: "x1", body: "a" });
		messages.append({ channelId: "c2", authorId: "u1", authorName: "u1", messageId: "x2", body: "b" });
		messages.append({ channelId: "c2", authorId: "u1", authorName: "u1", messageId: "x3", body: "c" });
		const commit = memories.commit.bind(memories);
		memories.commit = (channelId, extraction, lastSeq) => {
			if (channelId === "c1") throw new Error("disco cheio");
			commit(channelId, extraction, lastSeq);
		};
		expect(await consolidate.all(["c1", "c2"])).toEqual({ channels: 1, memories: 1 });
		expect(logger.lines.some((l) => l.includes("disco cheio"))).toBe(true);
	});
});
