import { describe, expect, it } from "bun:test";
import { FakeClock } from "../test-support/fakes/clock.ts";
import { FakeConfigStore } from "../test-support/fakes/config-store.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { FakeSubAgents } from "../test-support/fakes/sub-agents.ts";
import { Persona } from "./persona.ts";
import type { ChatAgent, ChatRequest, ChatSessions, ToolStep } from "./ports/chat-agent.ts";
import { Swarm } from "./swarm.ts";
import { WebChat } from "./web-chat.ts";

function setup(answer: (r: ChatRequest) => Promise<string> = async () => "resposta bot", webUser = "dono") {
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
	const workers = new FakeSubAgents();
	workers.answer = async (task) => {
		if (!task.tools) return '{"tasks": ["A", "B"]}';
		task.onToolStep?.({ tool: "web_fetch", args: "{}", output: task.text, durationMs: 2 });
		return `achei ${task.text}`;
	};
	let n = 0;
	const chat = new WebChat({
		messages,
		agent,
		swarm: new Swarm(workers),
		config: new FakeConfigStore({ discord: { admin_ids: ["dono"] }, dashboard: { web_user_id: webUser } }),
		persona: new Persona(souls, new FakeMemoryStore(), messages),
		clock: new FakeClock(Date.parse("2026-09-27T12:00:00.000Z")),
		newId: () => `web-${++n}`,
	});
	return { chat, asked, messages, live, workers };
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

describe("WebChat.send com /swarm", () => {
	it("admin: roda o swarm, repassa os passos por agente e o agente da conversa junta os resultados", async () => {
		const { chat, asked, messages, workers } = setup();
		const steps: ToolStep[] = [];
		const bot = await chat.send("s1", "/swarm compara A e B", { accepted: () => undefined, step: (s) => void steps.push(s) });
		expect(workers.tasks.map((t) => t.text)).toEqual(["compara A e B", "A", "B"]);
		expect(steps.map((s) => [s.agent, s.tool])).toEqual([
			[1, "web_fetch"],
			[2, "web_fetch"],
			[undefined, "web_search"],
		]);
		expect(asked).toHaveLength(1);
		expect(asked[0]?.channelId).toBe("web:s1");
		expect(asked[0]?.text).toContain("### Agente 1: A\nachei A");
		expect(asked[0]?.text).toContain("### Agente 2: B\nachei B");
		expect(bot.body).toBe("resposta bot");
		expect(messages.messages.map((m) => m.body)).toEqual(["/swarm compara A e B", "resposta bot"]);
	});

	it("quem nao e admin e recusado antes de gravar", async () => {
		const { chat, asked, messages, workers } = setup(undefined, "outro");
		await expect(chat.send("s1", "/swarm compara A e B", noEvents)).rejects.toThrow("/swarm é só para admin");
		expect(workers.tasks).toEqual([]);
		expect(asked).toEqual([]);
		expect(messages.messages).toEqual([]);
	});

	it("mensagem comum nao aciona o swarm", async () => {
		const { chat, workers } = setup();
		await chat.send("s1", "oi", noEvents);
		expect(workers.tasks).toEqual([]);
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
