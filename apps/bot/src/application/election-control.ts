/**
 * Caso de uso: liga/desliga o acompanhamento da apuracao (/apuracao, so admin).
 * Ligar fixa o canal onde o comando foi usado; sem opcao, so mostra o estado.
 */

import { roleOf } from "@/domain/roles.ts";
import type { ConfigStore } from "./ports/config-store.ts";

export interface ElectionControlDeps {
	config: ConfigStore;
	adminIds: () => readonly string[];
}

export interface ElectionChange {
	authorId: string;
	channelId: string;
	enabled?: boolean;
}

export class ElectionControl {
	private readonly deps: ElectionControlDeps;

	constructor(deps: ElectionControlDeps) {
		this.deps = deps;
	}

	apply(change: ElectionChange): string {
		const { config, adminIds } = this.deps;
		if (roleOf(change.authorId, adminIds()) !== "admin") return "só o dono mexe na apuração.";
		if (change.enabled) config.set("election.channel_id", change.channelId);
		if (change.enabled !== undefined) config.set("election.enabled", change.enabled);
		const election = config.all().election;
		return election.enabled
			? `apuração ligada em <#${election.channel_id}>: resumo a cada 30 min e thread por estado a cada 1h.`
			: "apuração desligada.";
	}
}
