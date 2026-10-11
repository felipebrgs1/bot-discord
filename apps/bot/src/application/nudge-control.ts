/**
 * Caso de uso: liga/desliga o cutucao e troca o tempo de silencio (/cutucar,
 * so admin). Sem opcoes, so mostra o estado. A config vale para todos os canais.
 */

import { IDLE_MIN_RANGE } from "@/domain/idle-nudge.ts";
import { roleOf } from "@/domain/roles.ts";
import type { ConfigStore } from "./ports/config-store.ts";

export interface NudgeControlDeps {
	config: ConfigStore;
	adminIds: () => readonly string[];
}

export interface NudgeChange {
	authorId: string;
	enabled?: boolean;
	idleMin?: number;
}

export class NudgeControl {
	private readonly deps: NudgeControlDeps;

	constructor(deps: NudgeControlDeps) {
		this.deps = deps;
	}

	apply(change: NudgeChange): string {
		const { config, adminIds } = this.deps;
		if (roleOf(change.authorId, adminIds()) !== "admin") return "só o dono mexe no cutucão.";
		const { idleMin, enabled } = change;
		if (idleMin !== undefined && !(Number.isInteger(idleMin) && idleMin >= IDLE_MIN_RANGE.min && idleMin <= IDLE_MIN_RANGE.max)) {
			return `tempo entre ${IDLE_MIN_RANGE.min} e ${IDLE_MIN_RANGE.max} minutos, inteiro.`;
		}
		if (idleMin !== undefined) config.set("nudge.idle_min", idleMin);
		if (enabled !== undefined) config.set("nudge.enabled", enabled);
		const nudge = config.all().nudge;
		return nudge.enabled ? `cutucão ligado: puxo assunto depois de ${nudge.idle_min} min de canal parado.` : "cutucão desligado.";
	}
}
