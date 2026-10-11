import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { WorkerFactory } from "../adapters/out/pi-agent/pi-sub-agents.ts";
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

/** Planejador (sem tools) devolve 2 tarefas; workers devolvem um relatorio. */
const workerCalls: [string, boolean][] = [];
const fakeWorkers: WorkerFactory = {
	async create(_conversationId, _instructions, tools) {
		let asked = "";
		return {
			prompt: async (text: string) => {
				asked = text;
				workerCalls.push([text, tools]);
			},
			waitForIdle: async () => undefined,
			getLastAssistantText: () => (tools ? `relatorio ${asked}` : '{"tasks": ["A", "B"]}'),
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
	return compose({ dbPath: ":memory:", root, webDir: join(root, "dist"), cwd: "/tmp", env, sessionFactory: fakeSessions, workerFactory: fakeWorkers, http: noNetwork });
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

	it("/swarm do admin no painel roda planejador e workers e registra metrica swarm", async () => {
		const app = build();
		app.config.set("discord.admin_ids", ["dono"]);
		app.config.set("dashboard.web_user_id", "dono");
		workerCalls.length = 0;
		const handler = app.panelHandler();
		const sse = await call(handler, "POST", "/api/chat/sessions/s1/messages", { content: "/swarm compara A e B" });
		expect(sse).toContain("event: done");
		expect(workerCalls).toEqual([
			["compara A e B", false],
			["A", true],
			["B", true],
		]);
		const metrics = JSON.parse(await call(handler, "GET", "/api/metrics")) as { models: { operation: string; requests: number }[] };
		expect(metrics.models.find((m) => m.operation === "swarm")?.requests).toBe(3);
		app.db.close();
	});

	it("config do painel persiste no SQLite", async () => {
		const app = build();
		await call(app.panelHandler(), "PUT", "/api/model", { model: "m-x" });
		expect(app.config.all().chat.model).toBe("m-x");
		app.db.close();
	});

	it("conversa recebe as 8 tools do bot", () => {
		const app = build();
		expect(app.tools("c1").map((t) => t.name)).toEqual([
			"web_search",
			"web_fetch",
			"download_media",
			"generate_image",
			"search_history",
			"memory",
			"lista",
			"magnet",
		]);
		app.db.close();
	});

	it("generate_image (conversa) usa so o OpenRouter, com a chave e o modelo do /gerar, e larga a imagem no outbox da raiz", async () => {
		const root = rootWith("sou um bot");
		const calls: string[] = [];
		const http = (async (url: string | URL | Request, init?: RequestInit) => {
			const model = String((JSON.parse(String(init?.body)) as { model: unknown }).model);
			calls.push(`${String(url)} ${(init?.headers as Record<string, string>)["Authorization"]} ${model}`);
			return new Response(JSON.stringify({ data: [{ b64_json: "aW1n", media_type: "image/png" }] }));
		}) as typeof fetch;
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { OPENROUTER_API_KEY: "or-k" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http,
		});
		const tool = app.tools("c1").find((t) => t.name === "generate_image");
		const result = await tool?.execute("t", { prompt: "gato" } as never, undefined as never, undefined as never, {} as never);
		const first = result?.content[0];
		expect(first?.type === "text" ? first.text : "").toStartWith("ok:");
		expect(calls).toEqual(["https://openrouter.ai/api/v1/images Bearer or-k inclusionai/ming-image-0.1-design"]);
		expect(readdirSync(join(root, "outbox", "c1"))).toHaveLength(1);
		app.db.close();
	});

	it("/gerar usa o OpenRouter com a chave e o ming-image por padrao e larga a imagem no outbox da raiz", async () => {
		const root = rootWith("sou um bot");
		const calls: string[] = [];
		const http = (async (url: string | URL | Request, init?: RequestInit) => {
			const model = String((JSON.parse(String(init?.body)) as { model: unknown }).model);
			calls.push(`${String(url)} ${(init?.headers as Record<string, string>)["Authorization"]} ${model}`);
			return new Response(JSON.stringify({ data: [{ b64_json: "aW1n", media_type: "image/png" }] }));
		}) as typeof fetch;
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { OPENROUTER_API_KEY: "or-k" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http,
		});
		expect((await app.drawing.create("gato", "c1")).ok).toBe(true);
		expect(calls).toEqual(["https://openrouter.ai/api/v1/images Bearer or-k inclusionai/ming-image-0.1-design"]);
		expect(readdirSync(join(root, "outbox", "c1"))).toHaveLength(1);
		app.db.close();
	});

	it("/gerar prepara o prompt num worker sem tools, com o contexto do canal", async () => {
		const app = build();
		workerCalls.length = 0;
		const prompt = await app.prompting.write({ channelId: "c1", authorId: "u1", authorName: "ana", messageId: "m1", text: "imagem do grupo" });
		expect(prompt).toBe('{"tasks": ["A", "B"]}');
		expect(workerCalls).toEqual([[expect.stringContaining("imagem do grupo"), false]]);
		app.db.close();
	});

	it("OPENROUTER_IMAGE_MODEL troca o modelo do /gerar", async () => {
		const models: string[] = [];
		const http = (async (_url: string | URL | Request, init?: RequestInit) => {
			models.push(String((JSON.parse(String(init?.body)) as { model: unknown }).model));
			return new Response("{}");
		}) as typeof fetch;
		const root = rootWith("sou um bot");
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { OPENROUTER_API_KEY: "or-k", OPENROUTER_IMAGE_MODEL: "black-forest-labs/flux.2-pro" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http,
		});
		await app.drawing.create("gato", "c1");
		expect(models).toEqual(["black-forest-labs/flux.2-pro"]);
		app.db.close();
	});

	it("web_search usa o Tavily e cai para o Firecrawl quando o Tavily falha", async () => {
		const root = rootWith("sou um bot");
		const auth: string[] = [];
		const http = (async (url: string | URL | Request, init?: RequestInit) => {
			auth.push(`${String(url)} ${(init?.headers as Record<string, string>)["Authorization"]}`);
			if (String(url).includes("tavily")) return new Response("{}", { status: 432 });
			return new Response(JSON.stringify({ success: true, data: { web: [{ title: "Vasco", url: "https://v" }] } }));
		}) as typeof fetch;
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { TAVILY_API_KEY: "tvly-k", FIRECRAWL_API_KEY: "fc-k" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http,
		});
		const tool = app.tools("c1").find((t) => t.name === "web_search");
		const result = await tool?.execute("t", { query: "vasco" } as never, undefined as never, undefined as never, {} as never);
		const first = result?.content[0];
		expect(first?.type === "text" ? first.text : "").toContain("1. Vasco");
		expect(auth).toEqual(["https://api.tavily.com/search Bearer tvly-k", "https://api.firecrawl.dev/v2/search Bearer fc-k"]);
		app.db.close();
	});

	it("web_search sem chave configurada avisa qual variavel falta", async () => {
		const app = build();
		const tool = app.tools("c1").find((t) => t.name === "web_search");
		const result = await tool?.execute("t", { query: "vasco" } as never, undefined as never, undefined as never, {} as never);
		const first = result?.content[0];
		expect(first?.type === "text" ? first.text : "").toBe(
			"erro na pesquisa: nenhum buscador configurado (TAVILY_API_KEY ou FIRECRAWL_API_KEY)",
		);
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

	/** Cliente Discord falso: conta logins e registra a ordem com o painel. */
	function fakeDiscord(ordem: string[]) {
		let logins = 0;
		const client = {
			once: () => undefined,
			on: () => undefined,
			login: async () => {
				logins++;
				ordem.push("login");
			},
			destroy: () => undefined,
		};
		return { client, logins: () => logins };
	}

	it("sobe o painel antes de logar no Discord", async () => {
		const ordem: string[] = [];
		const discord = fakeDiscord(ordem);
		const root = rootWith("sou um bot");
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { DISCORD_TOKEN: "tok", DASHBOARD_PORT: "8080" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http: noNetwork,
			discordClient: discord.client as never,
			startPanel: async () => {
				ordem.push("painel");
				return { close: (cb?: () => void) => cb?.() } as never;
			},
		});
		const stop = await app.start();
		await stop();
		expect(ordem).toEqual(["painel", "login"]);
	});

	it("cutucao: canal da allowlist parado ha 30 min recebe pelo Discord a fala de um worker sem tools", async () => {
		const sent: [string, string][] = [];
		const client = {
			...fakeDiscord([]).client,
			channels: {
				fetch: async (id: string) => ({ isSendable: () => true, send: async (text: string) => void sent.push([id, text]) }),
			},
		};
		const root = rootWith("sou um bot");
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: {},
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http: noNetwork,
			discordClient: client as never,
		});
		app.config.set("discord", { channel_ids: ["c1"] });
		// Sem horario de silencio: o teste nao depende da hora em que roda.
		app.config.set("nudge.quiet_end_hour", 0);
		app.db
			.prepare("INSERT INTO messages (channel_id, author_id, author_name, message_id, body, created_at, from_bot) VALUES (?,?,?,?,?,?,0);")
			.run("c1", "u1", "ana", "m1", "oi", new Date(Date.now() - 31 * 60_000).toISOString());
		workerCalls.length = 0;
		await app.nudge.tick();
		expect(workerCalls).toHaveLength(1);
		expect(workerCalls[0]?.[0]).toContain("ana: oi");
		expect(workerCalls[0]?.[1]).toBe(false);
		expect(sent).toEqual([["c1", '{"tasks": ["A", "B"]}']]);
		app.db.close();
	});

	it("!cutucar do dono no Discord manda o cutucao no canal", async () => {
		const sent: [string, string][] = [];
		const handlers: Record<string, (m: unknown) => void> = {};
		const client = {
			...fakeDiscord([]).client,
			on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
			channels: {
				fetch: async (id: string) => ({ isSendable: () => true, send: async (text: string) => void sent.push([id, text]) }),
			},
		};
		const root = rootWith("sou um bot");
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { DISCORD_TOKEN: "tok", DASHBOARD_PORT: "0" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http: noNetwork,
			discordClient: client as never,
		});
		app.config.set("discord", { guild_id: "g1", channel_ids: ["c1"], admin_ids: ["dono"] });
		const stop = await app.start();
		const replies: string[] = [];
		handlers["messageCreate"]?.({
			id: "m1",
			guildId: "g1",
			channelId: "c1",
			author: { id: "dono", username: "dono", bot: false, system: false },
			webhookId: null,
			content: "!cutucar",
			cleanContent: "!cutucar",
			mentions: { users: { size: 0 }, has: () => false },
			attachments: new Map(),
			stickers: new Map(),
			reply: async (text: string) => void replies.push(text),
			channel: { messages: { cache: new Map() } },
		});
		await new Promise((r) => setTimeout(r, 20));
		await stop();
		expect(sent).toEqual([["c1", '{"tasks": ["A", "B"]}']]);
		expect(replies).toEqual([]);
	});

	it("porta do painel ocupada: erro antes de qualquer login no Discord", async () => {
		const discord = fakeDiscord([]);
		const root = rootWith("sou um bot");
		const app = compose({
			dbPath: ":memory:",
			root,
			webDir: join(root, "dist"),
			cwd: "/tmp",
			env: { DISCORD_TOKEN: "tok", DASHBOARD_PORT: "8080" },
			sessionFactory: fakeSessions,
			workerFactory: fakeWorkers,
			http: noNetwork,
			discordClient: discord.client as never,
			startPanel: async () => {
				throw new Error("EADDRINUSE: porta 8080 ocupada");
			},
		});
		await expect(app.start()).rejects.toThrow("EADDRINUSE");
		expect(discord.logins()).toBe(0);
		app.db.close();
	});
});
