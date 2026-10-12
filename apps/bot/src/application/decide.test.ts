import { describe, expect, it } from "bun:test";
import type { Verdict } from "@/domain/verdict.ts";
import { Decide } from "./decide.ts";
import type { Judge, Judgment } from "./ports/judge.ts";

function judge(answer: (j: Judgment) => Promise<Verdict>) {
	const calls: Judgment[] = [];
	const fake: Judge = {
		judge: (j) => {
			calls.push(j);
			return answer(j);
		},
	};
	return { calls, fake };
}

const PAPRIKA: Verdict = {
	kind: "choice",
	pick: "Paprika",
	confidence: 0.6,
	probabilities: [
		{ option: "Paprika", p: 0.8 },
		{ option: "Inception", p: 0.2 },
	],
};

describe("Decide.choose", () => {
	it("julga com pergunta, opcoes e contexto aparados e devolve o veredito formatado", async () => {
		const { calls, fake } = judge(async () => PAPRIKA);
		const text = await new Decide(fake).choose(" qual filme? ", ["Paprika", " Inception", "paprika"], " ana odeia anime ");
		expect(calls).toEqual([{ kind: "choice", question: "qual filme?", options: ["Paprika", "Inception"], context: "ana odeia anime" }]);
		expect(text.split("\n")[0]).toBe("veredito: Paprika (confiança 60%)");
	});

	it("pergunta vazia ou opcoes invalidas nao chamam o modelo", async () => {
		const { calls, fake } = judge(async () => PAPRIKA);
		const decide = new Decide(fake);
		expect(await decide.choose("  ", ["a", "b"])).toBe("erro: pergunta vazia");
		expect(await decide.choose("qual?", ["a"])).toBe("erro: informe pelo menos 2 opções diferentes");
		expect(calls).toEqual([]);
	});
});

describe("Decide.odds", () => {
	it("julga sim ou nao e devolve o veredito formatado", async () => {
		const { calls, fake } = judge(async () => ({ kind: "odds", p: 0.9 }));
		const text = await new Decide(fake).odds("devo ir pra academia hoje?");
		expect(calls).toEqual([{ kind: "odds", question: "devo ir pra academia hoje?", context: "" }]);
		expect(text.split("\n")[0]).toBe("veredito: sim (90%)");
	});

	it("falha do modelo vira texto", async () => {
		const { fake } = judge(async () => {
			throw new Error("typesafe HTTP 529");
		});
		expect(await new Decide(fake).odds("x?")).toBe("erro na decisão: typesafe HTTP 529");
	});
});

describe("Decide sem modelo configurado", () => {
	it("avisa qual variavel falta", async () => {
		const decide = new Decide(undefined);
		expect(await decide.odds("x?")).toBe("erro: decisão não configurada (TYPESAFE_API_KEY)");
		expect(await decide.choose("x?", ["a", "b"])).toBe("erro: decisão não configurada (TYPESAFE_API_KEY)");
	});
});
