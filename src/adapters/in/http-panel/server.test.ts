import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Panel } from "../../../application/panel.ts";
import { Persona } from "../../../application/persona.ts";
import type { ChatAgent, ChatSessions } from "../../../application/ports/chat-agent.ts";
import { WebChat } from "../../../application/web-chat.ts";
import { FakeClock } from "../../../test-support/fakes/clock.ts";
import { FakeConfigStore } from "../../../test-support/fakes/config-store.ts";
import { FakeLogger } from "../../../test-support/fakes/logger.ts";
import { FakeMemoryStore } from "../../../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../../../test-support/fakes/message-store.ts";
import { FakeMetrics } from "../../../test-support/fakes/metrics.ts";
import { FakeSoulStore } from "../../../test-support/fakes/soul-store.ts";
import { createPanelHandler } from "./server.ts";

function setup(password = "") {
	const live = new Set<string>();
	const agent: ChatAgent & ChatSessions = {
		ask: async (r) => {
			live.add(r.channelId);
			r.onToolStep?.({ tool: "web_search", args: '{"query":"x"}', output: "achado", durationMs: 2 });
			return "resposta bot";
		},
		conversations: () => [...live],
		forget: (c) => void live.delete(c),
	};
	const config = new FakeConfigStore();
	const souls = new FakeSoulStore();
	const memories = new FakeMemoryStore();
	const messages = new FakeMessageStore();
	const metrics = new FakeMetrics();
	let n = 0;
	const handler = createPanelHandler({
		panel: new Panel({ config, souls, sessions: agent, memories, metrics, logs: { after: () => ({ entries: [], cursor: 0 }) } }),
		chat: new WebChat({
			messages,
			agent,
			config,
			persona: new Persona(souls, memories, messages),
			clock: new FakeClock(0),
			newId: () => `web-${++n}`,
		}),
		logger: new FakeLogger(),
		webDir: "/nao-existe",
		password,
	});
	return { handler, memories, metrics };
}

interface Resp {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

function request(
	handler: (req: IncomingMessage, res: ServerResponse) => void,
	method: string,
	url: string,
	opts?: { body?: unknown; cookie?: string },
): Promise<Resp> {
	return new Promise((resolve) => {
		const req = Object.assign(new EventEmitter(), {
			method,
			url,
			headers: opts?.cookie ? { cookie: opts.cookie } : {},
		}) as unknown as IncomingMessage;
		let status = 200;
		const headers: Resp["headers"] = {};
		let raw = "";
		const res = {
			headersSent: false,
			writeHead: (s: number, h?: Resp["headers"]) => {
				status = s;
				Object.assign(headers, h ?? {});
			},
			setHeader: (k: string, v: string) => {
				headers[k.toLowerCase()] = v;
			},
			write: (c: string) => {
				raw += c;
			},
			end: (d?: unknown) => {
				if (typeof d === "string") raw += d;
				resolve({ status, headers, body: raw });
			},
		} as unknown as ServerResponse;
		handler(req, res);
		if (opts?.body !== undefined) req.emit("data", JSON.stringify(opts.body));
		req.emit("end");
	});
}

const j = (r: Resp): unknown => (r.body ? JSON.parse(r.body) : null);

function frames(r: Resp): { event: string; data: unknown }[] {
	return r.body
		.split("\n\n")
		.filter((f) => f.includes("data:"))
		.map((f) => ({
			event: /event:\s*(\S+)/.exec(f)?.[1] ?? "message",
			data: JSON.parse(
				f
					.split("\n")
					.filter((l) => l.startsWith("data:"))
					.map((l) => l.slice(5).trim())
					.join(""),
			),
		}));
}

describe("envelopes (contrato do front)", () => {
	it("memories {items}, learnings {events}, logs {entries,next}, meta, metrics", async () => {
		const { handler, metrics } = setup();
		metrics.record({
			operation: "chat",
			model: "m",
			provider: "p",
			source: "discord",
			status: "success",
			latencyMs: 10,
			inputTokens: 1,
			outputTokens: 2,
			cachedTokens: 0,
			cacheWriteTokens: 0,
			cost: 0,
		});
		expect(Array.isArray((j(await request(handler, "GET", "/api/memories")) as { items: unknown[] }).items)).toBe(true);
		expect(Array.isArray((j(await request(handler, "GET", "/api/learnings")) as { events: unknown[] }).events)).toBe(true);
		expect(j(await request(handler, "GET", "/api/logs"))).toEqual({ entries: [], next: 0 });
		expect(j(await request(handler, "GET", "/api/meta"))).toEqual({ chat: true, agent: true, model: "(padrão do pi)", role: "user" });
		const m = j(await request(handler, "GET", "/api/metrics")) as Record<string, unknown>;
		for (const k of ["summary", "series", "models", "recent", "options"]) expect(m[k], k).toBeDefined();
		expect(m["summary"]).toMatchObject({ requests: 1, input_tokens: 1, output_tokens: 2 });
		expect((m["recent"] as { total_tokens: number }[])[0]?.total_tokens).toBe(3);
	});
});

describe("auth", () => {
	it("sem senha tudo abre; com senha exige login", async () => {
		const open = setup("").handler;
		expect((await request(open, "GET", "/auth/session")).status).toBe(200);
		expect((await request(open, "GET", "/api/meta")).status).toBe(200);

		const h = setup("pw").handler;
		expect((await request(h, "GET", "/api/meta")).status).toBe(401);
		expect((await request(h, "POST", "/auth/login", { body: { password: "errada" } })).status).toBe(401);
		const ok = await request(h, "POST", "/auth/login", { body: { password: "pw" } });
		expect(ok.status).toBe(200);
		const cookie = String(ok.headers["set-cookie"] ?? "").split(";")[0] ?? "";
		expect(cookie).toContain("db_session=");
		expect((await request(h, "GET", "/api/meta", { cookie })).status).toBe(200);
		expect((await request(h, "POST", "/auth/logout", { cookie })).status).toBe(200);
		expect((await request(h, "GET", "/api/meta", { cookie })).status).toBe(401);
	});
});

describe("chat web", () => {
	it("POST faz SSE accepted/step/done; GET lista e mostra historico; DELETE apaga", async () => {
		const { handler } = setup();
		const post = await request(handler, "POST", "/api/chat/sessions/sABC123/messages", { body: { content: "oi" } });
		expect(post.status).toBe(200);
		const evs = frames(post);
		expect(evs.map((e) => e.event)).toEqual(["accepted", "step", "done"]);
		expect(evs[1]?.data).toEqual({ tool: "web_search", args: '{"query":"x"}', output: "achado", duration_ms: 2 });
		const done = evs[2]?.data as { message: { content: string; is_bot: boolean }; steps: unknown[] };
		expect(done.message).toMatchObject({ content: "resposta bot", is_bot: true });
		expect(done.steps).toHaveLength(1);

		const list = j(await request(handler, "GET", "/api/chat/sessions")) as { sessions: { id: string; messages: number }[] };
		expect(list.sessions.map((s) => [s.id, s.messages])).toEqual([["sABC123", 2]]);
		const msgs = j(await request(handler, "GET", "/api/chat/sessions/sABC123/messages")) as { messages: { content: string }[] };
		expect(msgs.messages.map((m) => m.content)).toEqual(["oi", "resposta bot"]);

		expect((await request(handler, "DELETE", "/api/chat/sessions/sABC123")).status).toBe(204);
		expect((j(await request(handler, "GET", "/api/chat/sessions")) as { sessions: unknown[] }).sessions).toEqual([]);
	});

	it("rejeita sessao invalida e mensagem vazia", async () => {
		const { handler } = setup();
		expect((await request(handler, "POST", "/api/chat/sessions/bad!id/messages", { body: { content: "oi" } })).status).toBe(400);
		expect((await request(handler, "POST", "/api/chat/sessions/s1/messages", { body: { content: "  " } })).status).toBe(400);
		expect((await request(handler, "PUT", "/api/chat/sessions/s1/messages", { body: {} })).status).toBe(405);
	});
});

describe("memorias", () => {
	it("lista, versoes, forget/restore e correct", async () => {
		const { handler, memories } = setup();
		memories.commit("c1", { summary: "", memories: [{ key: "jogo", kind: "preference", scope: "user", personId: "u1", content: "Terraria" }], episodes: [] }, 1);
		const id = memories.listActive(1)[0]?.id ?? 0;
		const list = j(await request(handler, "GET", "/api/memories")) as { items: Record<string, unknown>[] };
		expect(list.items[0]).toMatchObject({ id, channel_id: "c1", user_id: "u1", key: "jogo", content: "Terraria", version: 1 });

		expect(j(await request(handler, "POST", `/api/memories/${id}/forget`, { body: { reason: "teste" } }))).toEqual({ changed: true });
		expect((j(await request(handler, "GET", "/api/memories")) as { items: unknown[] }).items).toEqual([]);
		const versions = j(await request(handler, "GET", `/api/memories/${id}/versions`)) as { versions: { reason: string; kind: string }[] };
		expect(versions.versions.map((v) => v.reason)).toEqual(["consolidação", "teste"]);
		expect(versions.versions[0]?.kind).toBe("preference");

		await request(handler, "POST", `/api/memories/${id}/restore`, { body: {} });
		expect(j(await request(handler, "PUT", `/api/memories/${id}`, { body: { content: "Stardew Valley", reason: "mudou" } }))).toEqual({ changed: true });
		const after = j(await request(handler, "GET", "/api/memories")) as { items: { content: string; version: number }[] };
		expect(after.items[0]).toMatchObject({ content: "Stardew Valley", version: 4 });
	});

	it("404 em memoria inexistente; PUT vazio e 400", async () => {
		const { handler } = setup();
		expect((await request(handler, "GET", "/api/memories/999/versions")).status).toBe(404);
		expect((await request(handler, "PUT", "/api/memories/999", { body: { content: "x" } })).status).toBe(404);
		expect((await request(handler, "POST", "/api/memories/999/forget", { body: {} })).status).toBe(404);
		expect((await request(handler, "PUT", "/api/memories/1", { body: { content: "  " } })).status).toBe(400);
	});
});

describe("config", () => {
	it("GET/PUT do formulario do Discord", async () => {
		const { handler } = setup();
		expect((j(await request(handler, "GET", "/api/config/discord")) as Record<string, unknown>)["guild_id"]).toBe("");
		const put = await request(handler, "PUT", "/api/config/discord", {
			body: { guild_id: "g9", channel_ids: ["c9", 3], admin_ids: ["a9"], web_user_id: "a9", personality: "mente nova" },
		});
		expect(j(put)).toEqual({ saved: true, restart_required: true });
		expect(j(await request(handler, "GET", "/api/config/discord"))).toEqual({
			guild_id: "g9",
			channel_ids: ["c9"],
			admin_ids: ["a9"],
			web_user_id: "a9",
			personality: "mente nova",
		});
	});

	it("model: PUT troca, GET mostra", async () => {
		const { handler } = setup();
		expect(j(await request(handler, "PUT", "/api/model", { body: { model: "x-model" } }))).toEqual({ model: "x-model", restart_required: false });
		expect(j(await request(handler, "GET", "/api/models"))).toEqual({ models: [], model: "x-model" });
	});

	it("participacao responde stubs", async () => {
		const { handler } = setup();
		expect(j(await request(handler, "GET", "/api/participation"))).toEqual({ items: [] });
		expect(j(await request(handler, "POST", "/api/participation/x/approve", { body: {} }))).toEqual({ changed: true });
	});
});

describe("estatico", () => {
	it("sem build mostra instrucao; traversal e 403; rota de api desconhecida e 404", async () => {
		const { handler } = setup();
		const home = await request(handler, "GET", "/");
		expect(home.status).toBe(200);
		expect(home.body).toContain("Painel sem build");
		expect((await request(handler, "GET", "/%2e%2e%2fpackage.json")).status).toBe(403);
		expect((await request(handler, "GET", "/api/rota-xyz")).status).toBe(404);
	});
});
