import { describe, expect, it } from "bun:test";
import { extractionPrompt, familiarityText, validateExtraction } from "./memory.ts";
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

describe("extractionPrompt", () => {
	it("fala do bot aparece marcada e nao vira fato", () => {
		const prompt = extractionPrompt("c1", [
			line(1, "u1", "ana", "o Bruno torce pra quem?"),
			line(2, "b1", "elmatadore", "o Bruno e corintiano", true),
		]);
		expect(prompt).toContain("ana (u1): o Bruno torce pra quem?");
		expect(prompt).toContain("[bot] elmatadore (b1): o Bruno e corintiano");
		expect(prompt).toMatch(/\[bot\].*nunca/i);
	});
});

describe("validateExtraction", () => {
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
		);
		expect(r.summary).toBe("gostos de jogos");
		expect(r.memories).toEqual([
			{ key: "jogo-favorito", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" },
		]);
		expect(r.episodes).toHaveLength(1);
	});

	it("sem key, deriva do conteudo sem acento", () => {
		const r = validateExtraction({ memories: [{ kind: "fact", scope: "group", content: "Sextou é sagrado" }] }, []);
		expect(r.memories[0]?.key).toBe("sextou-e-sagrado");
	});

	it("memoria de grupo nunca guarda pessoa", () => {
		const r = validateExtraction(
			{ memories: [{ key: "k", kind: "culture", scope: "group", person_id: "u1", content: "c" }] },
			["u1"],
		);
		expect(r.memories[0]?.personId).toBe("");
	});

	it("tolera lixo sem quebrar", () => {
		expect(validateExtraction(null, [])).toEqual({ summary: "", memories: [], episodes: [] });
		expect(validateExtraction({ memories: "não-array" }, []).memories).toEqual([]);
	});
});

describe("extractionPrompt", () => {
	it("lista as mensagens com data, autor e id", () => {
		const prompt = extractionPrompt("c1", [line(1, "u1", "ana", "meu jogo é Terraria")]);
		expect(prompt).toContain("canal c1");
		expect(prompt).toContain("[2026-09-20 10:01] ana (u1): meu jogo é Terraria");
	});
});

describe("familiarityText", () => {
	it("junta as suas e as do grupo com cabecalho", () => {
		const text = familiarityText([{ kind: "preference", content: "ama Terraria" }], [{ kind: "culture", content: "sextou" }]);
		expect(text).toBe(
			"[memória do grupo e suas preferências]\n- [sua] (preference) ama Terraria\n- [grupo] (culture) sextou",
		);
	});

	it("vazio vira string vazia", () => {
		expect(familiarityText([], [])).toBe("");
	});

	it("corta no limite com reticencias", () => {
		const text = familiarityText([{ kind: "fact", content: "x".repeat(100) }], [], 50);
		expect(text).toHaveLength(51);
		expect(text.endsWith("…")).toBe(true);
	});
});
