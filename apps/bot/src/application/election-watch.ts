/**
 * Caso de uso: acompanha a apuracao de presidente no canal ligado pelo
 * /apuracao. Resumo (total e exterior) a cada 30 min, thread por estado a cada
 * 1h. Com 100% das secoes, posta o final e se desliga.
 *
 * O total e buscado a cada tick (barato, um arquivo) para pegar o 100% na hora.
 * Os horarios ficam em memoria: religar ou reiniciar posta na hora.
 */

import { isFinal, STATES, STATES_EVERY_MS, statesText, statesThreadName, SUMMARY_EVERY_MS, summaryText } from "@/domain/election.ts";
import { splitMessage } from "@/domain/reply-split.ts";
import type { Clock } from "./ports/clock.ts";
import type { ConfigStore } from "./ports/config-store.ts";
import type { ElectionRef, ElectionResults } from "./ports/election-results.ts";
import type { Logger } from "./ports/logger.ts";

export interface ElectionWatchDeps {
	results: ElectionResults;
	config: ConfigStore;
	clock: Clock;
	logger: Logger;
	/** Manda o texto no canal (adapter do Discord). */
	post: (channelId: string, chunks: readonly string[]) => Promise<void>;
	/** Abre uma thread no canal e manda o texto dentro dela. */
	openThread: (channelId: string, name: string, chunks: readonly string[]) => Promise<void>;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class ElectionWatch {
	private readonly deps: ElectionWatchDeps;
	private lastSummary: number | undefined;
	private lastStates: number | undefined;

	constructor(deps: ElectionWatchDeps) {
		this.deps = deps;
	}

	async tick(): Promise<void> {
		const { config, clock, logger, results } = this.deps;
		const election = config.all().election;
		if (!election.enabled || !election.channel_id) {
			this.lastSummary = undefined;
			this.lastStates = undefined;
			return;
		}
		const ref = { cycle: election.cycle, code: election.code };
		const channelId = election.channel_id;
		const total = await results.tally(ref, "br").catch((err: unknown) => {
			logger.warn(`apuracao ERRO total: ${errorText(err)}`);
			return null;
		});
		// O TSE publica o arquivo zerado antes de fechar a votacao.
		if (!total || total.sectionsPct === "0,00") return;
		const now = clock.now();
		const final = isFinal(total);
		if (final || this.lastSummary === undefined || now - this.lastSummary >= SUMMARY_EVERY_MS) {
			this.lastSummary = now;
			const abroad = await this.tallyOrNull(ref, "zz");
			await this.attempt("resumo", () => this.deps.post(channelId, splitMessage(summaryText(total, abroad))));
		}
		if (final || this.lastStates === undefined || now - this.lastStates >= STATES_EVERY_MS) {
			this.lastStates = now;
			const states = await Promise.all(STATES.map(async (uf) => ({ uf, tally: await this.tallyOrNull(ref, uf.toLowerCase()) })));
			const name = statesThreadName(now, election.time_zone);
			await this.attempt("estados", () => this.deps.openThread(channelId, name, splitMessage(statesText(states))));
		}
		if (final) {
			config.set("election.enabled", false);
			await this.attempt("final", () => this.deps.post(channelId, ["apuração encerrada (100% das seções): desliguei o acompanhamento."]));
		}
	}

	private async tallyOrNull(ref: ElectionRef, area: string) {
		try {
			return await this.deps.results.tally(ref, area);
		} catch {
			return null;
		}
	}

	private async attempt(what: string, send: () => Promise<void>): Promise<void> {
		try {
			await send();
			this.deps.logger.info(`apuracao ${what} postado`);
		} catch (err) {
			this.deps.logger.warn(`apuracao ERRO ${what}: ${errorText(err)}`);
		}
	}
}
