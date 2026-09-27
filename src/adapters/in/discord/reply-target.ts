/** ReplyTarget do Discord: reacoes de andamento, reply + mensagens seguintes, outbox no fim. */

import type { ReplyTarget } from "../../../application/reply-to-message.ts";

const WORKING_EMOJI = "⏱️";
const DONE_EMOJI = "✅";
const ERROR_EMOJI = "❌";

export interface Reactable {
	react(emoji: string): Promise<unknown>;
	reactions: { cache: Map<string, { users: { remove(id: string): Promise<unknown> } }> };
	channel: { sendTyping(): Promise<unknown> };
}

export type ReplyableMessage = Reactable & {
	reply(text: string): Promise<unknown>;
	channel: { send(text: string): Promise<unknown> };
};

async function tryReact(message: Reactable, emoji: string): Promise<void> {
	try {
		await message.react(emoji);
	} catch {
		/* sem permissao ou emoji desconhecido: a resposta segue */
	}
}

async function tryUnreact(message: Reactable, botUserId: string, emoji: string): Promise<void> {
	try {
		await message.reactions.cache.get(emoji)?.users.remove(botUserId);
	} catch {
		/* melhor esforco */
	}
}

/** ⏱️ + "digitando" enquanto work() roda; troca por ✅/❌. Reacao nunca quebra a resposta. */
export async function trackWorking<T>(message: Reactable, botUserId: string, work: () => Promise<T>): Promise<T> {
	await tryReact(message, WORKING_EMOJI);
	// "digitando" expira em ~10s: renova ate work() terminar (sem await: nao atrasa a resposta).
	let typing = true;
	void (async () => {
		while (typing) {
			try {
				await message.channel.sendTyping();
			} catch {
				/* ignora */
			}
			await new Promise((r) => setTimeout(r, 9000));
		}
	})();
	try {
		const result = await work();
		typing = false;
		await tryUnreact(message, botUserId, WORKING_EMOJI);
		await tryReact(message, DONE_EMOJI);
		return result;
	} catch (err) {
		typing = false;
		await tryUnreact(message, botUserId, WORKING_EMOJI);
		await tryReact(message, ERROR_EMOJI);
		throw err;
	}
}

export function discordReplyTarget(
	message: ReplyableMessage,
	botUserId: string,
	afterReply: () => Promise<void>,
): ReplyTarget {
	return {
		whileWorking: (work) => trackWorking(message, botUserId, work),
		async deliver(chunks) {
			for (const [i, chunk] of chunks.entries()) {
				if (i === 0) await message.reply(chunk);
				else await message.channel.send(chunk);
			}
			await afterReply();
		},
		async fail(text) {
			await afterReply();
			await message.reply(text).catch(() => undefined);
		},
	};
}
