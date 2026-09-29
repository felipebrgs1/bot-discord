import { describe, expect, it } from "bun:test";
import { extractionPrompt, groupMemoryText, turnText, validateExtraction } from "./memory.ts";
import type { StoredMessage } from "./message.ts";
import type { MemoryHit } from "./memory.ts";

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

describe("extractionPrompt", () => {
	it("fala do bot aparece marcada e nao vira fato", () => {
		const prompt = extractionPrompt(
			"c1",
			[line(1, "u1", "ana", "o Bruno torce pra quem?"), line(2, "b1", "elmatadore", "o Bruno e corintiano", true)],
			[],
		);
		expect(prompt).toContain("ana (u1): o Bruno torce pra quem?");
		expect(prompt).toContain("[bot] elmatadore (b1): o Bruno e corintiano");
		expect(prompt).toMatch(/\[bot\].*nunca/i);
	});
});

describe("validateExtraction", () => {
	const known: MemoryHit[] = [
		{ key: "jogo-favorito", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" },
		{ key: "joga-lol", kind: "fact", scope: "user", personId: "u2", content: "joga LoL" },
		{ key: "sextou", kind: "culture", scope: "group", personId: "", content: "sextou é sagrado" },
	];

	it("aceita memoria valida e descarta atribuicao errada", () => {
		const r = validateExtraction(
			{
				summary: "gostos de jogos",
				memories: [
					{ key: "jogo-favorito", kind: "preference", scope: "user", person_id: "u1", content: "ama Terraria" },
					{ key: "x", kind: "preference", scope: "user", person_id: "u9", content: "atribuído a quem não falou" },
					{ key: "y", kind: "meme", scope: "group", content: "kind inválido" },
					{ key: "", kind: "fact", scope: "group", content: "" },
				],
				episodes: [{ key: "e1", title: "A saga", summary: "resumo" }],
			},
			["u1", "u2"],
			[],
		);
		expect(r.summary).toBe("gostos de jogos");
		expect(r.memories).toEqual([
			{ key: "jogo-favorito", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" },
		]);
		expect(r.episodes).toHaveLength(1);
	});

	it("sem key, deriva do conteudo sem acento", () => {
		const r = validateExtraction({ memories: [{ kind: "fact", scope: "group", content: "Sextou é sagrado" }] }, [], []);
		expect(r.memories[0]?.key).toBe("sextou-e-sagrado");
	});

	it("memoria de grupo nunca guarda pessoa", () => {
		const r = validateExtraction(
			{ memories: [{ key: "k", kind: "culture", scope: "group", person_id: "u1", content: "c" }] },
			["u1"],
			[],
		);
		expect(r.memories[0]?.personId).toBe("");
	});

	it("forget e confirm so valem para memoria conhecida", () => {
		const r = validateExtraction(
			{
				forget: [
					{ key: "joga-lol", scope: "user", person_id: "u2", reason: "disse que largou" },
					{ key: "inventada", scope: "group", reason: "nao existe" },
				],
				confirm: [
					{ key: "sextou", scope: "group" },
					{ key: "sextou", scope: "user", person_id: "u1" },
				],
			},
			["u1", "u2"],
			known,
		);
		expect(r.forget).toEqual([{ key: "joga-lol", scope: "user", personId: "u2", reason: "disse que largou" }]);
		expect(r.confirm).toEqual([{ key: "sextou", scope: "group", personId: "" }]);
	});

	it("memoria de pessoa so e esquecida ou confirmada se ela falou no lote", () => {
		const r = validateExtraction(
			{
				forget: [{ key: "joga-lol", scope: "user", person_id: "u2", reason: "o Bruno largou, disse a Ana" }],
				confirm: [{ key: "joga-lol", scope: "user", person_id: "u2" }],
			},
			["u1"],
			known,
		);
		expect(r.forget).toEqual([]);
		expect(r.confirm).toEqual([]);
	});

	it("tolera lixo sem quebrar", () => {
		expect(validateExtraction(null, [], [])).toEqual({ summary: "", memories: [], forget: [], confirm: [], episodes: [] });
		expect(validateExtraction({ memories: "não-array", forget: 3 }, [], known).memories).toEqual([]);
	});
});

describe("extractionPrompt", () => {
	it("lista as mensagens com data, autor e id", () => {
		const prompt = extractionPrompt("c1", [line(1, "u1", "ana", "meu jogo é Terraria")], []);
		expect(prompt).toContain("canal c1");
		expect(prompt).toContain("[2026-09-20 10:01] ana (u1): meu jogo é Terraria");
	});

	it("mostra as memorias atuais com key, escopo e pessoa para o modelo reusar", () => {
		const prompt = extractionPrompt(
			"c1",
			[line(1, "u1", "ana", "larguei o Terraria")],
			[{ key: "jogo-favorito", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" }],
		);
		expect(prompt).toContain("key=jogo-favorito scope=user person_id=u1 (preference): ama Terraria");
		expect(prompt).toContain('"forget"');
		expect(prompt).toContain('"confirm"');
	});

	it("sem memorias atuais diz que nao ha nenhuma", () => {
		expect(extractionPrompt("c1", [line(1, "u1", "ana", "oi")], [])).toContain("(nenhuma)");
	});
});

describe("groupMemoryText", () => {
	it("lista as memorias do grupo com cabecalho", () => {
		expect(groupMemoryText([{ kind: "culture", content: "sextou é sagrado" }])).toBe(
			"[memória do grupo]\n- (culture) sextou é sagrado",
		);
	});

	it("vazio vira string vazia", () => {
		expect(groupMemoryText([])).toBe("");
	});

	it("corta no limite sem quebrar linha no meio", () => {
		const text = groupMemoryText(
			[
				{ kind: "culture", content: "a".repeat(20) },
				{ kind: "culture", content: "b".repeat(20) },
			],
			50,
		);
		expect(text).toBe(`[memória do grupo]\n- (culture) ${"a".repeat(20)}`);
	});
});

describe("turnText", () => {
	const base = { authorId: "u1", authorName: "Ana", text: "o que vc achou?", mine: [], recent: [] };

	it("diz quem esta falando antes da mensagem", () => {
		expect(turnText(base)).toBe("[mensagem de Ana (id u1)]\no que vc achou?");
	});

	it("inclui o que lembra da pessoa e a conversa recente do canal", () => {
		const text = turnText({
			...base,
			mine: [{ kind: "preference", content: "odeia spoiler" }],
			recent: [
				{ authorName: "Bruno", body: "alguém viu o trailer?" },
				{ authorName: "Ana", body: "vi, ficou bom" },
			],
		});
		expect(text).toBe(
			[
				"[mensagem de Ana (id u1)]",
				"[o que você lembra de Ana]",
				"- (preference) odeia spoiler",
				"[conversa no canal desde sua última fala]",
				"Bruno: alguém viu o trailer?",
				"Ana: vi, ficou bom",
				"---",
				"o que vc achou?",
			].join("\n"),
		);
	});

	it("memorias da pessoa cabem num teto, sem cortar linha, as mais importantes primeiro", () => {
		const text = turnText({
			...base,
			mine: [
				{ kind: "preference", content: "odeia spoiler" },
				{ kind: "fact", content: "x".repeat(900) },
			],
		});
		expect(text).toContain("- (preference) odeia spoiler");
		expect(text).not.toContain("xxx");
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
