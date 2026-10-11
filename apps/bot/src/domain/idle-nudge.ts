/**
 * Cutucao de canal parado: depois de `idleMs` sem humano falando, o bot puxa
 * assunto uma vez. Sem resposta, fica quieto ate alguem falar de novo.
 */

export interface NudgeRules {
	idleMs: number;
	/** Horario de silencio [inicio, fim) no fuso `timeZone`; pode atravessar a meia-noite. */
	quietStartHour: number;
	quietEndHour: number;
	timeZone: string;
}

export interface NudgeHistoryItem {
	createdAt: string;
	fromBot: boolean;
}

function localHour(now: number, timeZone: string): number {
	const hour = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(now);
	return Number(hour);
}

function isQuiet(now: number, rules: NudgeRules): boolean {
	const hour = localHour(now, rules.timeZone);
	const { quietStartHour: start, quietEndHour: end } = rules;
	return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/**
 * Cutuca quando o ultimo humano falou ha `idleMs` (dentro de uma janela de
 * mais `idleMs`, para nao cutucar silencio velho depois de restart), fora do
 * horario de silencio, e nenhuma fala do bot veio depois do prazo (cutucao ja feito).
 */
export function shouldNudge(recent: readonly NudgeHistoryItem[], now: number, rules: NudgeRules): boolean {
	const lastHuman = recent.findLast((m) => !m.fromBot);
	if (!lastHuman) return false;
	const deadline = Date.parse(lastHuman.createdAt) + rules.idleMs;
	if (now < deadline || now >= deadline + rules.idleMs) return false;
	const nudged = recent.some((m) => m.fromBot && Date.parse(m.createdAt) >= deadline);
	return !nudged && !isQuiet(now, rules);
}

/** Turno que pede o cutucao ao agente; `idleMin` ausente = forcado (!cutucar). */
export function nudgeText(idleMin: number | undefined, recent: readonly { authorName: string; body: string }[]): string {
	const lines = recent
		.filter((m) => !m.body.startsWith("!"))
		.map((m) => `${m.authorName}: ${m.body}`)
		.join("\n");
	const situation = idleMin === undefined ? "Hora de agitar o canal." : `O canal esta parado ha ${idleMin} minutos.`;
	return [
		`[aviso interno, ninguem escreveu isto] ${situation}`,
		"Mande UMA mensagem curta para puxar assunto, no seu jeito, sem dizer que e automatico e sem marcar ninguem.",
		"Responda so com o texto da mensagem.",
		lines ? `Conversa recente:\n${lines}` : "",
	]
		.filter(Boolean)
		.join("\n");
}
