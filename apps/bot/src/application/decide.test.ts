import { describe, expect, it } from "bun:test";
import { formatVerdict, type Verdict } from "@/domain/verdict.ts";
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

const ATTACHED = "ok: o bloco do veredito vai anexado no fim da sua resposta; não repita, só comente o resultado.";

describe("Decide.choose", () => {
	it("julga com pergunta, opcoes e contexto aparados e mostra o veredito ao agente", async () => {
		const { calls, fake } = judge(async () => PAPRIKA);
		const text = await new Decide(fake).choose("c1", " qual filme? ", ["Paprika", " Inception", "paprika"], " ana odeia anime ");
		expect(calls).toEqual([{ kind: "choice", question: "qual filme?", options: ["Paprika", "Inception"], context: "ana odeia anime" }]);
		expect(text).toBe(`${ATTACHED}\n${formatVerdict(PAPRIKA)}`);
	});

	it("pergunta vazia ou opcoes invalidas nao chamam o modelo", async () => {
		const { calls, fake } = judge(async () => PAPRIKA);
		const decide = new Decide(fake);
		expect(await decide.choose("c1", "  ", ["a", "b"])).toBe("erro: pergunta vazia");
		expect(await decide.choose("c1", "qual?", ["a"])).toBe("erro: informe pelo menos 2 opções diferentes");
		expect(calls).toEqual([]);
	});
});

describe("Decide.odds", () => {
	it("julga sim ou nao e mostra o veredito ao agente", async () => {
		const { calls, fake } = judge(async () => ({ kind: "odds", p: 0.9 }));
		const text = await new Decide(fake).odds("c1", "devo ir pra academia hoje?");
		expect(calls).toEqual([{ kind: "odds", question: "devo ir pra academia hoje?", context: "" }]);
		expect(text).toBe(`${ATTACHED}\n${formatVerdict({ kind: "odds", p: 0.9 })}`);
	});

	it("falha do modelo vira texto", async () => {
		const { fake } = judge(async () => {
			throw new Error("typesafe HTTP 529");
		});
		expect(await new Decide(fake).odds("c1", "x?")).toBe("erro na decisão: typesafe HTTP 529");
	});
});

describe("Decide.take", () => {
	it("entrega os vereditos do canal uma vez, na ordem", async () => {
		const decide = new Decide(judge(async (j) => (j.kind === "odds" ? { kind: "odds", p: 0.9 } : PAPRIKA)).fake);
		await decide.choose("c1", "qual?", ["Paprika", "Inception"]);
		await decide.odds("c1", "vai?");
		await decide.odds("c2", "e la?");
		expect(decide.take("c1")).toEqual([formatVerdict(PAPRIKA), formatVerdict({ kind: "odds", p: 0.9 })]);
		expect(decide.take("c1")).toEqual([]);
		expect(decide.take("c2")).toHaveLength(1);
	});

	it("erro nao vira veredito", async () => {
		const decide = new Decide(
			judge(async () => {
				throw new Error("x");
			}).fake,
		);
		await decide.odds("c1", "vai?");
		await decide.choose("c1", "qual?", ["a"]);
		expect(decide.take("c1")).toEqual([]);
	});
});

describe("Decide.prejudge", () => {
	const QUESTION = "Qual conclusão decorre?\nA) Todos os Zéglis são Vroblis.\nB) Nenhum Tróvi é Nérgli.";
	const B: Verdict = {
		kind: "choice",
		pick: "B",
		confidence: 0.8,
		probabilities: [
			{ option: "A", p: 0.1 },
			{ option: "B", p: 0.9 },
		],
	};

	it("questao de multipla escolha: julga as alternativas, guarda o veredito e devolve a nota do turno", async () => {
		const { calls, fake } = judge(async () => B);
		const decide = new Decide(fake);
		expect(await decide.prejudge("c1", QUESTION)).toBe(
			"[questão de múltipla escolha: o modelo de decisão escolheu a alternativa B (confiança 80%). Responda B e explique do seu jeito; se discordar, diga por quê. O bloco com as probabilidades vai anexado no fim da sua resposta: não repita.]",
		);
		expect(calls).toEqual([
			{
				kind: "choice",
				question: "Qual conclusão decorre?",
				options: ["A", "B"],
				descriptions: { A: "Todos os Zéglis são Vroblis.", B: "Nenhum Tróvi é Nérgli." },
				context: "",
			},
		]);
		expect(decide.take("c1")).toEqual([formatVerdict(B)]);
	});

	it("mensagem comum, falha do modelo ou sem modelo: nada", async () => {
		const { calls, fake } = judge(async () => B);
		expect(await new Decide(fake).prejudge("c1", "bora jogar?")).toBeNull();
		expect(calls).toEqual([]);
		const failing = new Decide(
			judge(async () => {
				throw new Error("x");
			}).fake,
		);
		expect(await failing.prejudge("c1", QUESTION)).toBeNull();
		expect(failing.take("c1")).toEqual([]);
		expect(await new Decide(undefined).prejudge("c1", QUESTION)).toBeNull();
	});
});

describe("Decide sem modelo configurado", () => {
	it("avisa qual variavel falta", async () => {
		const decide = new Decide(undefined);
		expect(await decide.odds("c1", "x?")).toBe("erro: decisão não configurada (TYPESAFE_API_KEY)");
		expect(await decide.choose("c1", "x?", ["a", "b"])).toBe("erro: decisão não configurada (TYPESAFE_API_KEY)");
	});
});
