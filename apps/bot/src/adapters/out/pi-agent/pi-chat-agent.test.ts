import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ChatRequest, ToolStep } from "../../../application/ports/chat-agent.ts";
import { FakeMetrics } from "../../../test-support/fakes/metrics.ts";
import { PiChatAgent } from "./pi-chat-agent.ts";
import { type SessionFactory, SessionPool } from "./session-pool.ts";

interface Fake {
	prompts: unknown[][];
	systemPrompts: (string | undefined)[];
	listeners: ((e: unknown) => void)[];
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

function setup(behavior: (fake: Fake) => Promise<void> = async () => undefined) {
	const fake: Fake = { prompts: [], systemPrompts: [], listeners: [], tokens: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 } };
	const factory: SessionFactory = {
		async create(_c, _r, systemPrompt) {
			fake.systemPrompts.push(systemPrompt);
			return {
				model: { id: "modelo-real", provider: "prov" },
				prompt: async (...a: unknown[]) => {
					fake.prompts.push(a);
					await behavior(fake);
				},
				waitForIdle: async () => undefined,
				getLastAssistantText: () => "resposta",
				getSessionStats: () => ({ tokens: { ...fake.tokens }, cost: fake.tokens.output / 1000 }),
				subscribe: (cb: (e: unknown) => void) => {
					fake.listeners.push(cb);
					return () => fake.listeners.splice(fake.listeners.indexOf(cb), 1);
				},
				dispose: () => undefined,
			} as unknown as AgentSession;
		},
		dispose: () => undefined,
	};
	let now = 1000;
	const metrics = new FakeMetrics();
	const agent = new PiChatAgent({
		pool: new SessionPool(factory),
		metrics,
		model: () => "modelo-config",
		now: () => (now += 50),
	});
	return { fake, metrics, agent };
}

const request = (over: Partial<ChatRequest> = {}): ChatRequest => ({
	channelId: "c1",
	authorId: "u1",
	role: "user",
	text: "oi",
	images: [],
	...over,
});

describe("PiChatAgent", () => {
	it("responde, passa o prompt extra e as imagens", async () => {
		const { fake, agent } = setup();
		const answer = await agent.ask(request({ systemPrompt: "soul", images: [{ data: "AAA", mimeType: "image/png" }] }));
		expect(answer).toBe("resposta");
		expect(fake.systemPrompts).toEqual(["soul"]);
		expect(fake.prompts[0]).toEqual(["oi", { images: [{ type: "image", data: "AAA", mimeType: "image/png" }] }]);
	});

	it("registra o turno com o delta de tokens e o modelo real", async () => {
		const { metrics, agent } = setup(async (fake) => {
			fake.tokens = { input: 130, output: 25, cacheRead: 7, cacheWrite: 0 };
		});
		await agent.ask(request({ source: "web" }));
		expect(metrics.turns).toHaveLength(1);
		expect(metrics.turns[0]).toMatchObject({
			operation: "chat",
			model: "modelo-real",
			provider: "prov",
			source: "web",
			status: "success",
			latencyMs: 50,
			inputTokens: 30,
			outputTokens: 15,
			cachedTokens: 7,
			cacheWriteTokens: 0,
		});
		expect(metrics.turns[0]?.cost).toBeCloseTo(0.015);
	});

	it("erro do agente registra turno com erro e propaga", async () => {
		const { metrics, agent } = setup(async () => {
			throw new Error("modelo caiu");
		});
		await expect(agent.ask(request())).rejects.toThrow("modelo caiu");
		expect(metrics.turns[0]?.status).toBe("error");
	});

	it("passos de tool chegam com args, saida e duracao, e a escuta termina no fim", async () => {
		const steps: ToolStep[] = [];
		const { fake, agent } = setup(async (f) => {
			for (const l of f.listeners) {
				l({ type: "tool_execution_start", toolCallId: "t1", toolName: "web_search", args: { query: "x" } });
				l({ type: "tool_execution_end", toolCallId: "t1", toolName: "web_search", result: { content: [{ type: "text", text: "achado" }] } });
			}
		});
		await agent.ask(request({ onToolStep: (s) => void steps.push(s) }));
		expect(steps).toEqual([{ tool: "web_search", args: '{"query":"x"}', output: "achado", durationMs: 50 }]);
		expect(fake.listeners).toEqual([]);
	});

	it("sem onToolStep nao escuta eventos", async () => {
		const { fake, agent } = setup();
		await agent.ask(request());
		expect(fake.listeners).toEqual([]);
	});

	it("conversations e forget refletem o pool", async () => {
		const { agent } = setup();
		await agent.ask(request({ channelId: "web:s1" }));
		expect(agent.conversations()).toEqual(["web:s1"]);
		agent.forget("web:s1");
		expect(agent.conversations()).toEqual([]);
	});
});
