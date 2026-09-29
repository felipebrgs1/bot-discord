import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** Raiz temporaria com personality.md (obrigatorio na montagem). */
function rootWith(personality: string | undefined): string {
	const root = mkdtempSync(join(tmpdir(), "bot-root-"));
	if (personality !== undefined) writeFileSync(join(root, "personality.md"), personality);
	return root;
}

function build(env: Record<string, string> = {}, root = rootWith("sou um bot")) {
	return compose({ dbPath: ":memory:", root, webDir: join(root, "dist"), cwd: "/tmp", env, sessionFactory: fakeSessions, http: noNetwork });
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

describe("compose: AGENT_MODEL", () => {
	it("formato sem provider/ impede subir", () => {
		expect(() => build({ AGENT_MODEL: "gpt-6-luna" })).toThrow("AGENT_MODEL");
	});

	it("vira o modelo mostrado no painel", async () => {
		const app = build({ AGENT_MODEL: "openai-codex/gpt-6-luna" });
		const meta = JSON.parse(await call(app.panelHandler(), "GET", "/api/meta")) as { model: string };
		expect(meta.model).toBe("openai-codex/gpt-6-luna");
	});
});

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

	it("personalidade vem do personality.md da raiz e e relida a cada chamada", () => {
		const root = rootWith("sou o elmatadore\n");
		const app = build({}, root);
		expect(app.personality()).toBe("sou o elmatadore");
		writeFileSync(join(root, "personality.md"), "mudei");
		expect(app.personality()).toBe("mudei");
		app.db.close();
	});

	it("banco novo: soul padrao comeca vazia, a base e o personality.md", async () => {
		const app = build();
		const form = JSON.parse(await call(app.panelHandler(), "GET", "/api/config/discord")) as { personality: string };
		expect(form.personality).toBe("");
		app.db.close();
	});

	it("sem personality.md ou com ele vazio a montagem falha", () => {
		expect(() => build({}, rootWith(undefined))).toThrow("personality.md");
		expect(() => build({}, rootWith("  \n"))).toThrow("personality.md");
	});

	it("sem DISCORD_TOKEN nao sobe", async () => {
		const app = build();
		await expect(app.start()).rejects.toThrow("DISCORD_TOKEN não definido");
		app.db.close();
	});
});
