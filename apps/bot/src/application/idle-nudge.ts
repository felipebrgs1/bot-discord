/**
 * Caso de uso: puxar assunto em canal parado (regra em domain/idle-nudge).
 *
 * A propria fala do bot entra no historico pelo gateway e marca o cutucao
 * (sobrevive a restart). Enquanto ela nao chega, e quando o envio falha, a
 * memoria de tentativas garante uma so por silencio.
 */

import { nudgeText, shouldNudge } from "@/domain/idle-nudge.ts";
import { splitMessage } from "@/domain/reply-split.ts";
import type { NudgeConfig } from "@/domain/settings.ts";
import type { Clock } from "./ports/clock.ts";
import type { Logger } from "./ports/logger.ts";
import type { MessageStore } from "./ports/message-store.ts";
import type { SubAgents } from "./ports/sub-agents.ts";

export interface IdleNudgeDeps {
	messages: MessageStore;
	/** Sub-agente efemero: nao disputa a sessao do canal com as respostas. */
	agents: SubAgents;
	clock: Clock;
	logger: Logger;
	settings: () => { channelIds: readonly string[]; nudge: NudgeConfig };
	/** Voz do bot no canal: personalidade + soul + memoria do grupo. */
	instructionsFor: (channelId: string) => string;
	/** Manda o texto no canal (adapter do Discord). */
	send: (channelId: string, chunks: readonly string[]) => Promise<void>;
}

const HISTORY_LIMIT = 30;
const RECENT_LIMIT = 15;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class IdleNudge {
	private readonly deps: IdleNudgeDeps;
	/** Canal -> messageId do ultimo humano ja cutucado. */
	private readonly attempted = new Map<string, string>();

	constructor(deps: IdleNudgeDeps) {
		this.deps = deps;
	}

	async tick(): Promise<void> {
		const { channelIds, nudge } = this.deps.settings();
		if (!nudge.enabled) return;
		const rules = {
			idleMs: nudge.idle_min * 60_000,
			quietStartHour: nudge.quiet_start_hour,
			quietEndHour: nudge.quiet_end_hour,
			timeZone: nudge.time_zone,
		};
		for (const channelId of channelIds) {
			const history = this.deps.messages.latest(channelId, HISTORY_LIMIT);
			const lastHuman = history.findLast((m) => !m.fromBot);
			if (!lastHuman || this.attempted.get(channelId) === lastHuman.messageId) continue;
			if (!shouldNudge(history, this.deps.clock.now(), rules)) continue;
			this.attempted.set(channelId, lastHuman.messageId);
			try {
				await this.nudge(channelId, nudge.idle_min, history);
			} catch (err) {
				this.deps.logger.warn(`cutucao ERRO canal=${channelId}: ${errorText(err)}`);
			}
		}
	}

	/** Cutuca agora (!cutucar), sem olhar silencio, horario nem `enabled`; falha sobe. */
	async force(channelId: string): Promise<void> {
		const history = this.deps.messages.latest(channelId, HISTORY_LIMIT);
		const lastHuman = history.findLast((m) => !m.fromBot);
		if (lastHuman) this.attempted.set(channelId, lastHuman.messageId);
		await this.nudge(channelId, undefined, history);
	}

	private async nudge(channelId: string, idleMin: number | undefined, history: readonly { authorName: string; body: string }[]): Promise<void> {
		this.deps.logger.info(`cutucao canal=${channelId}${idleMin === undefined ? " forcado" : ""}`);
		const answer = await this.deps.agents.run({
			instructions: this.deps.instructionsFor(channelId),
			text: nudgeText(idleMin, history.slice(-RECENT_LIMIT)),
			tools: false,
			conversationId: channelId,
		});
		if (!answer.trim()) throw new Error("modelo terminou sem texto");
		await this.deps.send(channelId, splitMessage(answer));
	}
}
