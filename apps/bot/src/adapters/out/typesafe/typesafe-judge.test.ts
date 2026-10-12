import { describe, expect, it } from "bun:test";
import { TypeSafeJudge } from "./typesafe-judge.ts";

function recorder(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { calls, http };
}

const CHOICE = {
	model: "jev-1.13.0",
	answers: {
		verdict: { type: "choice", choice: "Paprika", probabilities: { Paprika: 0.72, Inception: 0.28 }, confidence: 0.61 },
	},
	usage: { input_tokens: 1, output_tokens: 1 },
};

describe("TypeSafeJudge", () => {
	it("escolha: posta pergunta e contexto no state e as opcoes como criterios", async () => {
		const { calls, http } = recorder(200, CHOICE);
		await new TypeSafeJudge({ apiKey: "ts-k", http }).judge({
			kind: "choice",
			question: "Which movie?",
			options: ["Paprika", "Inception"],
			context: "Ana hates anime",
		});
		expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(calls[0]?.init.method).toBe("POST");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer ts-k");
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			model: "jev-latest",
			state: { question: "Which movie?", context: "Ana hates anime" },
			questions: {
				verdict: {
					type: "choice",
					instructions: "Pick the best answer to `question`, taking `context` into account.",
					criteria: { Paprika: null, Inception: null },
				},
			},
		});
	});

	it("escolha: devolve a vencedora, a confianca e a probabilidade de cada opcao na ordem pedida", async () => {
		const { http } = recorder(200, CHOICE);
		const verdict = await new TypeSafeJudge({ apiKey: "k", http }).judge({
			kind: "choice",
			question: "q",
			options: ["Inception", "Paprika"],
			context: "",
		});
		expect(verdict).toEqual({
			kind: "choice",
			pick: "Paprika",
			confidence: 0.61,
			probabilities: [
				{ option: "Inception", p: 0.28 },
				{ option: "Paprika", p: 0.72 },
			],
		});
	});

	it("escolha com descricao: cada opcao leva o texto da alternativa como criterio", async () => {
		const { calls, http } = recorder(200, {
			answers: { verdict: { type: "choice", choice: "B", probabilities: { A: 0.1, B: 0.9 }, confidence: 0.8 } },
		});
		await new TypeSafeJudge({ apiKey: "k", http }).judge({
			kind: "choice",
			question: "Qual conclusão decorre?",
			options: ["A", "B"],
			descriptions: { A: "Todos os Zéglis são Vroblis.", B: "Nenhum Tróvi é Nérgli." },
			context: "",
		});
		expect(JSON.parse(String(calls[0]?.init.body)).questions.verdict.criteria).toEqual({
			A: "Todos os Zéglis são Vroblis.",
			B: "Nenhum Tróvi é Nérgli.",
		});
	});

	it("sim ou nao: sem contexto o state so tem a pergunta; devolve o noul", async () => {
		const { calls, http } = recorder(200, { answers: { verdict: { type: "noul", noul: 0.82 } } });
		const verdict = await new TypeSafeJudge({ apiKey: "k", http }).judge({ kind: "odds", question: "Gym today?", context: "" });
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
			model: "jev-latest",
			state: { question: "Gym today?" },
			questions: { verdict: { type: "noul", instructions: "Is the answer to `question` yes?" } },
		});
		expect(verdict).toEqual({ kind: "odds", p: 0.82 });
	});

	it("HTTP de erro vira excecao com o status", async () => {
		const { http } = recorder(422, { detail: "x" });
		await expect(
			new TypeSafeJudge({ apiKey: "k", http }).judge({ kind: "odds", question: "q", context: "" }),
		).rejects.toThrow("typesafe HTTP 422");
	});

	it("resposta fora do formato vira excecao", async () => {
		const wrongType = recorder(200, { answers: { verdict: { type: "noul", noul: 0.5 } } });
		await expect(
			new TypeSafeJudge({ apiKey: "k", http: wrongType.http }).judge({ kind: "choice", question: "q", options: ["a", "b"], context: "" }),
		).rejects.toThrow("typesafe: resposta inesperada");
		const unknownPick = recorder(200, { answers: { verdict: { ...CHOICE.answers.verdict, choice: "Akira" } } });
		await expect(
			new TypeSafeJudge({ apiKey: "k", http: unknownPick.http }).judge({ kind: "choice", question: "q", options: ["Paprika", "Inception"], context: "" }),
		).rejects.toThrow("typesafe: resposta inesperada");
	});
});
