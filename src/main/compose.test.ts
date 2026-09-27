import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionFactory } from "../adapters/out/pi-agent/session-pool.ts";
import { compose } from "./compose.ts";

const fakeSessions: SessionFactory = {
	async create() {
		return {
			prompt: async () => undefined,
			waitForIdle: async () => undefined,
			getLastAssistantText: () => "resposta do agente",
			getSessionStats: () => ({ tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cost: 0 }),
			dispose: () => undefined,
		} as unknown as AgentSession;
	},
	dispose: () => undefined,
};

const noNetwork = (async () => {
	throw new Error("sem rede no teste");
}) as unknown as typeof fetch;

function build(env: Record<string, string> = {}) {
	return compose({ dbPath: ":memory:", root: "/nao-existe", cwd: "/tmp", env, sessionFactory: fakeSessions, http: noNetwork });
}

function call(handler: (req: IncomingMessage, res: ServerResponse) => void, method: string, url: string, body?: unknown): Promise<string> {
	return new Promise((resolve) => {
		const req = Object.assign(new EventEmitter(), { method, url, headers: {} }) as unknown as IncomingMessage;
		let raw = "";
		const res = {
			headersSent: false,
			writeHead: () => undefined,
			setHeader: () => undefined,
			write: (c: string) => void (raw += c),
			end: (d?: unknown) => resolve(raw + (typeof d === "string" ? d : "")),
		} as unknown as ServerResponse;
		handler(req, res);
		if (body !== undefined) req.emit("data", JSON.stringify(body));
		req.emit("end");
	});
}

describe("compose", () => {
	it("chat do painel passa pelo agente, grava historico e metrica no SQLite", async () => {
		const app = build();
		const handler = app.panelHandler();
		const sse = await call(handler, "POST", "/api/chat/sessions/s1/messages", { content: "oi" });
		expect(sse).toContain("event: done");
		expect(sse).toContain("resposta do agente");
		const history = JSON.parse(await call(handler, "GET", "/api/chat/sessions/s1/messages")) as { messages: { content: string }[] };
		expect(history.messages.map((m) => m.content)).toEqual(["oi", "resposta do agente"]);
		const metrics = JSON.parse(await call(handler, "GET", "/api/metrics")) as { summary: { requests: number } };
		expect(metrics.summary.requests).toBe(1);
		app.db.close();
	});

	it("config do painel persiste no SQLite", async () => {
		const app = build();
		await call(app.panelHandler(), "PUT", "/api/model", { model: "m-x" });
		expect(app.config.all().chat.model).toBe("m-x");
		app.db.close();
	});

	it("conversa recebe as 7 tools do bot", () => {
		const app = build();
		expect(app.tools("c1").map((t) => t.name)).toEqual([
			"web_search",
			"web_fetch",
			"download_media",
			"search_history",
			"memory_search",
			"lista",
			"magnet",
		]);
		app.db.close();
	});

	it("sem DISCORD_TOKEN nao sobe", async () => {
		const app = build();
		await expect(app.start()).rejects.toThrow("DISCORD_TOKEN não definido");
		app.db.close();
	});
});
