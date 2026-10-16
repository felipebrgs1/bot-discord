/**
 * Veredito de um modelo de decisao: escolha entre opcoes (com a distribuicao)
 * ou probabilidade de "sim". Validacao das opcoes e texto para o agente repassar.
 */

export type Verdict =
	| { kind: "choice"; pick: string; confidence: number; probabilities: { option: string; p: number }[] }
	| { kind: "odds"; p: number };

/** Regra fixa do prompt da sessao: decisao pedida ao bot passa pelo modelo de decisao. */
export const DECISION_GUIDANCE = `Decisões: quando alguém pedir para você escolher entre opções ("x ou y?", "qual desses?") ou decidir sim ou não ("devo...?", "vale a pena...?"), chame choose ou yes_or_no antes de responder. Isso vale também para política, religião e temas polêmicos: não recuse a escolha, chame choose ou yes_or_no. Não decida de cabeça: o veredito vem do modelo de decisão e você comenta o resultado do seu jeito.`;

/** Teto de opcoes numa escolha (legibilidade no Discord). */
export const MAX_OPTIONS = 10;

/** Opcoes aparadas e sem repeticao; string = erro para o modelo. */
export function parseOptions(options: string[]): string[] | string {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of options) {
		const option = raw.trim();
		const key = option.toLowerCase();
		if (!option || seen.has(key)) continue;
		seen.add(key);
		out.push(option);
	}
	if (out.length < 2) return "informe pelo menos 2 opções diferentes";
	if (out.length > MAX_OPTIONS) return `no máximo ${MAX_OPTIONS} opções`;
	return out;
}

const percent = (p: number) => `${Math.round(p * 100)}%`;
const bar = (p: number) => {
	const filled = Math.round(p * 10);
	return "█".repeat(filled) + "░".repeat(10 - filled);
};

/** Texto do veredito com barras num bloco de codigo (monoespacado no Discord). */
export function formatVerdict(verdict: Verdict): string {
	if (verdict.kind === "odds") {
		const label = verdict.p >= 0.65 ? "sim" : verdict.p <= 0.35 ? "não" : "dividido";
		return [`veredito: ${label} (${percent(verdict.p)})`, "```", `${bar(verdict.p)} ${percent(verdict.p)}`, "```"].join("\n");
	}
	const rows = [...verdict.probabilities].sort((a, b) => b.p - a.p);
	const width = Math.max(...rows.map((r) => r.option.length));
	return [
		`veredito: ${verdict.pick} (confiança ${percent(verdict.confidence)})`,
		"```",
		...rows.map((r) => `${r.option.padEnd(width)} ${bar(r.p)} ${percent(r.p)}`),
		"```",
	].join("\n");
}

/** Questao de multipla escolha: enunciado + alternativas rotuladas (A, B, C...). */
export interface MultipleChoice {
	question: string;
	options: { label: string; text: string }[];
}

const ALTERNATIVE = /^\s*\(?([a-j])[).:-]\s+(.*)$/i;

/** Enunciado seguido de alternativas A), B)... em ordem (a. ou (a) tambem); null quando nao e questao. */
export function parseMultipleChoice(text: string): MultipleChoice | null {
	const lines = text.split("\n");
	const first = lines.findIndex((l) => ALTERNATIVE.exec(l)?.[1]?.toUpperCase() === "A");
	if (first <= 0) return null;
	const question = lines.slice(0, first).join("\n").trim();
	const options: { label: string; text: string }[] = [];
	for (const line of lines.slice(first)) {
		const match = ALTERNATIVE.exec(line);
		const expected = String.fromCharCode(65 + options.length);
		if (match?.[1]?.toUpperCase() === expected) options.push({ label: expected, text: (match[2] ?? "").trim() });
		else if (line.trim() && options.length > 0) {
			const last = options[options.length - 1];
			if (last) last.text = `${last.text}\n${line.trim()}`;
		}
	}
	if (!question || options.length < 2) return null;
	return { question, options };
}
