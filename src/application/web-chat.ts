/**
 * Chat do painel: conversas "web:<sessao>" com o mesmo agente do Discord,
 * persistidas no historico; o usuario do painel e dashboard.web_user_id.
 */

import { roleOf } from "../domain/roles.ts";
import type { StoredMessage } from "../domain/message.ts";
import type { Persona } from "./persona.ts";
import type { ChatAgent, ChatSessions, ToolStep } from "./ports/chat-agent.ts";
import type { Clock } from "./ports/clock.ts";
import type { ConfigStore } from "./ports/config-store.ts";
import type { MessageStore } from "./ports/message-store.ts";

export interface WebSessionSummary {
	id: string;
	title: string;
	updatedAt: string;
	messages: number;
}

export interface WebChatDeps {
	messages: MessageStore;
	agent: ChatAgent & ChatSessions;
	config: ConfigStore;
	persona: Persona;
	clock: Clock;
	newId: () => string;
}

export interface SendEvents {
	accepted(message: StoredMessage): void;
	step(step: ToolStep): void;
}

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEB_PREFIX = "web:";
const MAX_HISTORY = 1000;
/** Como o modelo chama quem fala pelo painel. */
const WEB_AUTHOR = "painel";

export class WebChat {
	private readonly deps: WebChatDeps;

	constructor(deps: WebChatDeps) {
		this.deps = deps;
	}

	static validId(id: string): boolean {
		return SESSION_RE.test(id);
	}

	/** Sessoes web com agente vivo. */
	list(): WebSessionSummary[] {
		return this.deps.agent
			.conversations()
			.filter((c) => c.startsWith(WEB_PREFIX))
			.map((conversation) => {
				const id = conversation.slice(WEB_PREFIX.length);
				const rows = this.deps.messages.listChannel(conversation, MAX_HISTORY);
				return {
					id,
					title: rows.find((r) => r.body)?.body.slice(0, 60) || id,
					updatedAt: rows.at(-1)?.createdAt ?? new Date(this.deps.clock.now()).toISOString(),
					messages: rows.length,
				};
			});
	}

	history(id: string): StoredMessage[] {
		return this.deps.messages.listChannel(WEB_PREFIX + id, MAX_HISTORY);
	}

	/** Grava a pergunta, avisa, pergunta ao agente e grava a resposta (devolvida). */
	async send(id: string, content: string, events: SendEvents): Promise<StoredMessage> {
		const { messages, agent, config, persona, clock, newId } = this.deps;
		const conversation = WEB_PREFIX + id;
		const at = new Date(clock.now()).toISOString();
		const save = (authorId: string, authorName: string, body: string, fromBot: boolean): StoredMessage => {
			const stored = messages.append({
				channelId: conversation,
				authorId,
				authorName,
				messageId: newId(),
				body,
				createdAt: at,
				fromBot,
			});
			if (!stored) throw new Error("mensagem duplicada");
			return stored;
		};
		const question = save("web", "você", content, false);
		events.accepted(question);
		const settings = config.all();
		const webUser = settings.dashboard.web_user_id;
		const answer = await agent.ask({
			channelId: conversation,
			authorId: webUser,
			role: roleOf(webUser, settings.discord.admin_ids),
			text: persona.turnText({
				channelId: conversation,
				authorId: webUser,
				authorName: WEB_AUTHOR,
				messageId: question.messageId,
				text: content,
			}),
			images: [],
			source: "web",
			systemPrompt: persona.systemPromptFor(conversation),
			onToolStep: (step) => events.step(step),
		});
		return save("bot", "bot", answer, true);
	}

	remove(id: string): void {
		this.deps.agent.forget(WEB_PREFIX + id);
		this.deps.messages.deleteChannel(WEB_PREFIX + id);
	}
}
