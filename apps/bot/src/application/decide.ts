/**
 * Decisoes para o agente (escolha entre opcoes, sim ou nao); erro vira texto, nunca excecao.
 * O veredito fica guardado por canal para a resposta anexar (take): a probabilidade
 * chega ao usuario sem depender do modelo copiar o bloco.
 */

import { formatVerdict, parseMultipleChoice, parseOptions } from "@/domain/verdict.ts";
import type { Judge, Judgment } from "./ports/judge.ts";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const ATTACHED = "ok: o bloco do veredito vai anexado no fim da sua resposta; não repita, só comente o resultado.";

export class Decide {
	private readonly judge: Judge | undefined;
	private readonly pending = new Map<string, string[]>();

	constructor(judge: Judge | undefined) {
		this.judge = judge;
	}

	/** Vereditos do canal ainda nao entregues; esvazia. */
	take(channelId: string): string[] {
		const out = this.pending.get(channelId) ?? [];
		this.pending.delete(channelId);
		return out;
	}

	/**
	 * Questao de multipla escolha na mensagem: o Jev julga antes do agente (o modelo
	 * da conversa nao e obrigado a chamar a tool). Devolve a nota do turno ou null.
	 */
	async prejudge(channelId: string, text: string): Promise<string | null> {
		const quiz = parseMultipleChoice(text);
		if (!quiz || !this.judge) return null;
		try {
			const verdict = await this.judge.judge({
				kind: "choice",
				question: quiz.question,
				options: quiz.options.map((o) => o.label),
				descriptions: Object.fromEntries(quiz.options.map((o) => [o.label, o.text])),
				context: "",
			});
			if (verdict.kind !== "choice") return null;
			this.record(channelId, formatVerdict(verdict));
			return `[questão de múltipla escolha: o modelo de decisão escolheu a alternativa ${verdict.pick} (confiança ${Math.round(verdict.confidence * 100)}%). Responda ${verdict.pick} e explique do seu jeito; se discordar, diga por quê. O bloco com as probabilidades vai anexado no fim da sua resposta: não repita.]`;
		} catch {
			return null;
		}
	}

	async choose(channelId: string, question: string, options: string[], context = ""): Promise<string> {
		const parsed = parseOptions(options);
		if (typeof parsed === "string") return `erro: ${parsed}`;
		return this.run(channelId, { kind: "choice", question: question.trim(), options: parsed, context: context.trim() });
	}

	async odds(channelId: string, question: string, context = ""): Promise<string> {
		return this.run(channelId, { kind: "odds", question: question.trim(), context: context.trim() });
	}

	private async run(channelId: string, judgment: Judgment): Promise<string> {
		if (!this.judge) return "erro: decisão não configurada (TYPESAFE_API_KEY)";
		if (!judgment.question) return "erro: pergunta vazia";
		try {
			const text = formatVerdict(await this.judge.judge(judgment));
			this.record(channelId, text);
			return `${ATTACHED}\n${text}`;
		} catch (err) {
			return `erro na decisão: ${errorText(err)}`;
		}
	}

	private record(channelId: string, text: string): void {
		this.pending.set(channelId, [...(this.pending.get(channelId) ?? []), text]);
	}
}
