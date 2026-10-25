/**
 * Apuracao da eleicao para presidente (2º turno): textos do resumo e da
 * thread por estado. Numeros chegam do TSE ja calculados (percentual em texto
 * com virgula); aqui so ordena e formata.
 */

export interface CandidateTally {
	number: string;
	/** Nome de urna. */
	name: string;
	votes: number;
	/** Percentual dos validos, ex.: "50,12". */
	pct: string;
	elected: boolean;
}

/** Resultado de uma abrangencia: "br" (Brasil + exterior), "zz" (exterior) ou UF minuscula. */
export interface AreaTally {
	area: string;
	/** Data e hora da totalizacao, ex.: "25/10/2026 19:30:12". */
	updatedAt: string;
	/** Secoes totalizadas, ex.: "87,32". */
	sectionsPct: string;
	candidates: CandidateTally[];
	blank: number;
	nulls: number;
}

export interface StateTally {
	uf: string;
	/** null: TSE ainda nao publicou ou a busca falhou. */
	tally: AreaTally | null;
}

/** Resumo no canal a cada 30 min; thread por estado a cada 1h. */
export const SUMMARY_EVERY_MS = 30 * 60_000;
export const STATES_EVERY_MS = 60 * 60_000;

export const STATES: readonly string[] = [
	"AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
	"PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
];

const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const ranked = (t: AreaTally) => [...t.candidates].sort((a, b) => b.votes - a.votes);

function areaBlock(title: string, t: AreaTally): string[] {
	return [
		`**${title}**: ${t.sectionsPct}% das seções apuradas`,
		...ranked(t).map((c, i) => `${i + 1}. ${c.name} (${c.number}): ${c.pct}% (${thousands(c.votes)} votos)${c.elected ? ", ELEITO" : ""}`),
		`Brancos: ${thousands(t.blank)} · Nulos: ${thousands(t.nulls)}`,
	];
}

export function summaryText(total: AreaTally, abroad: AreaTally | null): string {
	const lines = [`**Apuração 2º turno: Presidente** (TSE, ${total.updatedAt})`, "", ...areaBlock("Total (Brasil + exterior)", total)];
	if (abroad) lines.push("", ...areaBlock("Exterior", abroad));
	return lines.join("\n");
}

export function statesText(states: readonly StateTally[]): string {
	return states
		.map(({ uf, tally }) =>
			tally
				? `**${uf}** (${tally.sectionsPct}% apurado): ${ranked(tally)
						.map((c) => `${c.name} ${c.pct}%`)
						.join(" · ")}`
				: `**${uf}**: sem dados ainda`,
		)
		.join("\n");
}

export function statesThreadName(now: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
	const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	return `Apuração por estado: ${part("day")}/${part("month")} ${part("hour")}:${part("minute")}`;
}

export function isFinal(t: AreaTally): boolean {
	return t.sectionsPct === "100,00";
}
