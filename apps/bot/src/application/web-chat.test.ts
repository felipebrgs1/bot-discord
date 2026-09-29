import { describe, expect, it } from "bun:test";
import { FakeClock } from "../test-support/fakes/clock.ts";
import { FakeConfigStore } from "../test-support/fakes/config-store.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { Persona } from "./persona.ts";
import type { ChatAgent, ChatRequest, ChatSessions, ToolStep } from "./ports/chat-agent.ts";
import { WebChat } from "./web-chat.ts";

function setup(answer: (r: ChatRequest) => Promise<string> = async () => "resposta bot") {
	const asked: ChatRequest[] = [];
	const live = new Set<string>();
	const agent: ChatAgent & ChatSessions = {
		ask: async (r) => {
			asked.push(r);
			live.add(r.channelId);
			r.onToolStep?.({ tool: "web_search", args: "{}", output: "achado", durationMs: 3 });
			return answer(r);
		},
		conversations: () => [...live],
		forget: (c) => void live.delete(c),
	};
	const souls = new FakeSoulStore();
	souls.ensureSeed("sou o bot");
	const messages = new FakeMessageStore();
	let n = 0;
	const chat = new WebChat({
		messages,
		agent,
		config: new FakeConfigStore({ discord: { admin_ids: ["dono"] }, dashboard: { web_user_id: "dono" } }),
		persona: new Persona(souls, new FakeMemoryStore(), messages),
		clock: new FakeClock(Date.parse("2026-09-27T12:00:00.000Z")),
		newId: () => `web-${++n}`,
	});
	return { chat, asked, messages, live };
}

const noEvents = { accepted: () => undefined, step: () => undefined };

describe("WebChat.validId", () => {
	it("so letras, numeros, _ e -, ate 64", () => {
		expect(WebChat.validId("sABC_1-2")).toBe(true);
		expect(WebChat.validId("bad!id")).toBe(false);
		expect(WebChat.validId("")).toBe(false);
		expect(WebChat.validId("a".repeat(65))).toBe(false);
	});
});

describe("WebChat.send", () => {
	it("grava a pergunta, avisa, pergunta como o usuario do painel e grava a resposta", async () => {
		const { chat, asked, messages } = setup();
		const accepted: string[] = [];
		const steps: ToolStep[] = [];
		const bot = await chat.send("s1", "oi", { accepted: (m) => void accepted.push(m.body), step: (s) => void steps.push(s) });
		expect(accepted).toEqual(["oi"]);
		expect(steps.map((s) => s.tool)).toEqual(["web_search"]);
		expect(bot).toMatchObject({ channelId: "web:s1", authorId: "bot", body: "resposta bot" });
		expect(asked[0]).toMatchObject({
			channelId: "web:s1",
			authorId: "dono",
			role: "admin",
			text: "[mensagem de painel (id dono)]\noi",
			images: [],
			source: "web",
			systemPrompt: "sou o bot",
		});
		expect(messages.messages.map((m) => [m.authorId, m.authorName, m.createdAt])).toEqual([
			["web", "você", "2026-09-27T12:00:00.000Z"],
			["bot", "bot", "2026-09-27T12:00:00.000Z"],
		]);
	});

	it("resposta gravada como do bot: turno seguinte nao repete a conversa", async () => {
		const { chat, asked, messages } = setup();
		await chat.send("s1", "oi", noEvents);
		await chat.send("s1", "e ai?", noEvents);
		expect(messages.messages.map((m) => m.fromBot)).toEqual([false, true, false, true]);
		expect(asked[1]?.text).toBe("[mensagem de painel (id dono)]\ne ai?");
	});

	it("erro do agente propaga e nao grava resposta", async () => {
		const { chat, messages } = setup(async () => {
			throw new Error("modelo caiu");
		});
		await expect(chat.send("s1", "oi", noEvents)).rejects.toThrow("modelo caiu");
		expect(messages.messages.map((m) => m.authorId)).toEqual(["web"]);
	});
});

describe("WebChat.list / history / remove", () => {
	it("lista sessoes vivas com titulo, contagem e ultima data", async () => {
		const { chat } = setup();
		await chat.send("s1", "primeira pergunta", noEvents);
		expect(chat.list()).toEqual([
			{ id: "s1", title: "primeira pergunta", updatedAt: "2026-09-27T12:00:00.000Z", messages: 2 },
		]);
		expect(chat.history("s1").map((m) => m.body)).toEqual(["primeira pergunta", "resposta bot"]);
	});

	it("remove derruba a sessao e apaga o historico", async () => {
		const { chat, live } = setup();
		await chat.send("s1", "oi", noEvents);
		chat.remove("s1");
		expect(live.size).toBe(0);
		expect(chat.list()).toEqual([]);
		expect(chat.history("s1")).toEqual([]);
	});
});
