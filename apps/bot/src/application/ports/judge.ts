import type { Verdict } from "@/domain/verdict.ts";

/** Pergunta para o modelo de decisao; context = o que se sabe de quem pergunta. */
export type Judgment =
	| { kind: "choice"; question: string; options: string[]; context: string }
	| { kind: "odds"; question: string; context: string };

/** Modelo de decisao: julga a pergunta e devolve veredito tipado. */
export interface Judge {
	judge(judgment: Judgment): Promise<Verdict>;
}
