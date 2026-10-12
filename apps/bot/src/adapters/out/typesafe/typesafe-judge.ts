/**
 * Judge pela API System One do TypeSafe (modelo Jev): Choice para escolha entre
 * opcoes, Noul para sim ou nao. https://docs.typesafe.ai/api
 */

import type { Judge, Judgment } from "@/application/ports/judge.ts";
import type { Verdict } from "@/domain/verdict.ts";

export interface TypeSafeJudgeOptions {
	apiKey: string;
	http?: typeof fetch;
	timeoutMs?: number;
}

interface TypeSafeAnswer {
	type?: string;
	choice?: string;
	probabilities?: Record<string, number>;
	confidence?: number;
	noul?: number;
}

/** Pergunta no state; a instrucao aponta para os campos pelo caminho entre crases. */
function question(judgment: Judgment) {
	const state = judgment.context ? { question: judgment.question, context: judgment.context } : { question: judgment.question };
	const withContext = judgment.context ? ", taking `context` into account" : "";
	if (judgment.kind === "odds") return { state, verdict: { type: "noul", instructions: `Is the answer to \`question\` yes${withContext}?` } };
	return {
		state,
		verdict: {
			type: "choice",
			instructions: `Pick the best answer to \`question\`${withContext}.`,
			criteria: Object.fromEntries(judgment.options.map((o) => [o, null])),
		},
	};
}

function toVerdict(judgment: Judgment, answer: TypeSafeAnswer | undefined): Verdict {
	if (judgment.kind === "odds" && answer?.type === "noul" && typeof answer.noul === "number") return { kind: "odds", p: answer.noul };
	if (
		judgment.kind === "choice" &&
		answer?.type === "choice" &&
		answer.choice !== undefined &&
		judgment.options.includes(answer.choice) &&
		typeof answer.confidence === "number"
	) {
		const probabilities = answer.probabilities ?? {};
		return {
			kind: "choice",
			pick: answer.choice,
			confidence: answer.confidence,
			probabilities: judgment.options.map((option) => ({ option, p: probabilities[option] ?? 0 })),
		};
	}
	throw new Error("typesafe: resposta inesperada");
}

export class TypeSafeJudge implements Judge {
	private readonly opts: TypeSafeJudgeOptions;

	constructor(opts: TypeSafeJudgeOptions) {
		this.opts = opts;
	}

	async judge(judgment: Judgment): Promise<Verdict> {
		const http = this.opts.http ?? fetch;
		const { state, verdict } = question(judgment);
		const res = await http("https://api.typesafe.ai/v1/systemone", {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
			body: JSON.stringify({ model: "jev-latest", state, questions: { verdict } }),
			signal: AbortSignal.timeout(this.opts.timeoutMs ?? 20_000),
		});
		if (!res.ok) throw new Error(`typesafe HTTP ${res.status}`);
		const data = (await res.json()) as { answers?: Record<string, TypeSafeAnswer> };
		return toVerdict(judgment, data.answers?.["verdict"]);
	}
}
