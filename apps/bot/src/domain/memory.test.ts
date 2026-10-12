import { describe, expect, it } from "bun:test";
import {
	applyMemoryEdit,
	blockSize,
	MEMORY_LIMITS,
	memoryBlockText,
	parseReviewEdits,
	reviewPrompt,
	replaceBlock,
	turnText,
} from "./memory.ts";
import type { StoredMessage } from "./message.ts";

const line = (seq: number, authorId: string, authorName: string, body: string, fromBot = false): StoredMessage => ({
	seq,
	channelId: "c1",
	authorId,
	authorName,
	messageId: `m${seq}`,
	body,
	replyTo: null,
	createdAt: `2026-09-20T10:0${seq}:00Z`,
	fromBot,
});

describe("applyMemoryEdit", () => {
	it("add acrescenta a entrada no fim, numa linha so", () => {
		const r = applyMemoryEdit(["odeia spoiler"], { action: "add", content: "  joga\n  Valorant  " }, 100);
		expect(r).toEqual({ ok: true, entries: ["odeia spoiler", "joga Valorant"] });
	});

	it("add vazio ou repetido e erro", () => {
		expect(applyMemoryEdit([], { action: "add", content: "  " }, 100).ok).toBe(false);
		const dup = applyMemoryEdit(["joga Valorant"], { action: "add", content: "Joga valorant" }, 100);
		expect(dup.ok).toBe(false);
		if (!dup.ok) expect(dup.error).toContain("já existe");
	});

	it("estourar o teto e erro que manda consolidar, sem mudar nada", () => {
		const r = applyMemoryEdit(["a".repeat(8)], { action: "add", content: "b".repeat(5) }, 12);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toContain("14/12");
			expect(r.error).toMatch(/replace|remove/);
		}
	});

	it("replace troca a entrada inteira achada por trecho, sem diferenciar maiuscula", () => {
		const r = applyMemoryEdit(["joga LoL", "odeia spoiler"], { action: "replace", oldText: "lol", content: "largou o LoL" }, 100);
		expect(r).toEqual({ ok: true, entries: ["largou o LoL", "odeia spoiler"] });
	});

	it("replace e remove pedem trecho que ache exatamente uma entrada", () => {
		const entries = ["joga LoL", "joga Valorant"];
		const none = applyMemoryEdit(entries, { action: "remove", oldText: "minecraft" }, 100);
		const many = applyMemoryEdit(entries, { action: "replace", oldText: "joga", content: "x" }, 100);
		expect(none.ok).toBe(false);
		expect(many.ok).toBe(false);
		if (!many.ok) expect(many.error).toContain("2 entradas");
	});

	it("remove tira a entrada", () => {
		expect(applyMemoryEdit(["joga LoL", "odeia spoiler"], { action: "remove", oldText: "spoiler" }, 100)).toEqual({
			ok: true,
			entries: ["joga LoL"],
		});
	});

	it("replace que reduz o tamanho passa mesmo com o bloco acima do teto", () => {
		const r = applyMemoryEdit(["a".repeat(20)], { action: "replace", oldText: "aaa", content: "curta" }, 10);
		expect(r).toEqual({ ok: true, entries: ["curta"] });
	});
});

describe("replaceBlock", () => {
	it("normaliza as entradas e descarta as vazias", () => {
		expect(replaceBlock(["x"], [" joga\nLoL ", "", "  "], 100)).toEqual({ ok: true, entries: ["joga LoL"] });
	});

	it("passar do teto e erro, a menos que encolha", () => {
		expect(replaceBlock([], ["a".repeat(11)], 10).ok).toBe(false);
		expect(replaceBlock(["a".repeat(20)], ["a".repeat(15)], 10).ok).toBe(true);
	});
});

describe("blockSize e limites", () => {
	it("conta as entradas e uma quebra entre elas", () => {
		expect(blockSize([])).toBe(0);
		expect(blockSize(["abc", "de"])).toBe(6);
	});

	it("grupo tem mais espaco que pessoa", () => {
		expect(MEMORY_LIMITS.group).toBe(2200);
		expect(MEMORY_LIMITS.user).toBe(1375);
	});
});

describe("memoryBlockText", () => {
	it("mostra titulo, uso do teto e uma entrada por linha", () => {
		expect(memoryBlockText("memória do grupo", ["abc", "de"], 100)).toBe("[memória do grupo] (6/100)\n- abc\n- de");
	});

	it("bloco vazio fica explicito", () => {
		expect(memoryBlockText("memória de Ana", [], 100)).toBe("[memória de Ana] (0/100)\n(vazia)");
	});
});

describe("turnText", () => {
	const base = { authorId: "u1", authorName: "Ana", text: "o que vc achou?", memory: [], recent: [] };

	it("sem contexto: quem fala e a mensagem", () => {
		expect(turnText(base)).toBe("[mensagem de Ana (id u1)]\no que vc achou?");
	});

	it("separa memoria e conversa recente da mensagem a responder", () => {
		const text = turnText({
			...base,
			memory: ["odeia spoiler"],
			recent: [
				{ authorName: "Bruno", body: "alguém viu o trailer?" },
				{ authorName: "Ana", body: "vi, ficou bom" },
			],
		});
		expect(text).toBe(
			[
				"[mensagem de Ana (id u1)]",
				`[memória de Ana] (13/${MEMORY_LIMITS.user})`,
				"- odeia spoiler",
				"[conversa recente no canal: só contexto, não é pergunta para você]",
				"Bruno: alguém viu o trailer?",
				"Ana: vi, ficou bom",
				"[responda só a esta mensagem de Ana]",
				"o que vc achou?",
			].join("\n"),
		);
	});

	it("imagens emprestadas do canal: avisa que sao so contexto", () => {
		expect(turnText({ ...base, borrowedImages: true })).toBe(
			[
				"[mensagem de Ana (id u1)]",
				"[as imagens anexadas são de mensagens anteriores do canal, não desta: só contexto; comente só se a pergunta for sobre elas]",
				"[responda só a esta mensagem de Ana]",
				"o que vc achou?",
			].join("\n"),
		);
	});

	it("conversa longa fica com as mensagens mais novas que cabem", () => {
		const text = turnText(
			{
				...base,
				recent: [
					{ authorName: "Bruno", body: "velha ".repeat(10) },
					{ authorName: "Bruno", body: "nova" },
				],
			},
			30,
		);
		expect(text).toContain("Bruno: nova");
		expect(text).not.toContain("velha");
	});
});

describe("reviewPrompt", () => {
	it("mostra os blocos atuais com o uso e marca fala de bot", () => {
		const prompt = reviewPrompt(
			[line(1, "u1", "ana", "larguei o LoL"), line(2, "b1", "elmatadore", "o Bruno e corintiano", true)],
			{ group: ["sextou é sagrado"], people: [{ personId: "u1", name: "ana", entries: ["joga LoL"] }] },
		);
		expect(prompt).toContain(`[memória do grupo] (16/${MEMORY_LIMITS.group})`);
		expect(prompt).toContain(`[memória de ana (person_id u1)] (8/${MEMORY_LIMITS.user})`);
		expect(prompt).toContain("ana (u1): larguei o LoL");
		expect(prompt).toContain("[bot] elmatadore (b1): o Bruno e corintiano");
		expect(prompt).toMatch(/\[bot\].*nunca/i);
	});
});

describe("parseReviewEdits", () => {
	it("traduz as edicoes validas para cada bloco", () => {
		const edits = parseReviewEdits(
			{
				edits: [
					{ target: "group", action: "add", content: "sextou é sagrado" },
					{ target: "user", person_id: "u1", action: "replace", old_text: "LoL", content: "largou o LoL" },
					{ target: "user", person_id: "u1", action: "remove", old_text: "spoiler" },
				],
			},
			"c1",
			["u1"],
		);
		expect(edits).toEqual([
			{ ref: { scope: "group", ownerId: "c1" }, edit: { action: "add", content: "sextou é sagrado" } },
			{ ref: { scope: "user", ownerId: "u1" }, edit: { action: "replace", oldText: "LoL", content: "largou o LoL" } },
			{ ref: { scope: "user", ownerId: "u1" }, edit: { action: "remove", oldText: "spoiler" } },
		]);
	});

	it("descarta pessoa que nao falou no lote, acao desconhecida e campos faltando", () => {
		const edits = parseReviewEdits(
			{
				edits: [
					{ target: "user", person_id: "u9", action: "add", content: "x" },
					{ target: "group", action: "apagar_tudo" },
					{ target: "group", action: "replace", content: "sem old_text" },
					{ target: "nada", action: "add", content: "x" },
				],
			},
			"c1",
			["u1"],
		);
		expect(edits).toEqual([]);
	});

	it("resposta fora do formato vira lista vazia", () => {
		expect(parseReviewEdits(null, "c1", [])).toEqual([]);
		expect(parseReviewEdits({ edits: "x" }, "c1", [])).toEqual([]);
	});
});
