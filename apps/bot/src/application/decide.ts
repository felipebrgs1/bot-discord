/** Decisoes para o agente (escolha entre opcoes, sim ou nao); erro vira texto, nunca excecao. */

import { formatVerdict, parseOptions } from "@/domain/verdict.ts";
import type { Judge, Judgment } from "./ports/judge.ts";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class Decide {
	private readonly judge: Judge | undefined;

	constructor(judge: Judge | undefined) {
		this.judge = judge;
	}

	async choose(question: string, options: string[], context = ""): Promise<string> {
		const parsed = parseOptions(options);
		if (typeof parsed === "string") return `erro: ${parsed}`;
		return this.run({ kind: "choice", question: question.trim(), options: parsed, context: context.trim() });
	}

	async odds(question: string, context = ""): Promise<string> {
		return this.run({ kind: "odds", question: question.trim(), context: context.trim() });
	}

	private async run(judgment: Judgment): Promise<string> {
		if (!this.judge) return "erro: decisão não configurada (TYPESAFE_API_KEY)";
		if (!judgment.question) return "erro: pergunta vazia";
		try {
			return formatVerdict(await this.judge.judge(judgment));
		} catch (err) {
			return `erro na decisão: ${errorText(err)}`;
		}
	}
}
