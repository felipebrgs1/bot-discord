/**
 * Painel web: API /api/* + front estatico (apps/web/dist). Traduz HTTP para os
 * casos de uso Panel e WebChat; formas de resposta sao as do contrato
 * @elmatadore/api, o mesmo que o front importa.
 */

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join, normalize, sep } from "node:path";
import type * as Api from "@elmatadore/api";
import type { Panel } from "../../../application/panel.ts";
import type { Logger } from "../../../application/ports/logger.ts";
import type { MemoryRecord } from "../../../application/ports/memory-admin.ts";
import type { MetricsTotals } from "../../../application/ports/metrics.ts";
import { WebChat } from "../../../application/web-chat.ts";
import type { StoredMessage } from "../../../domain/message.ts";

export interface PanelServerDeps {
	panel: Panel;
	chat: WebChat;
	logger: Logger;
	/** Diretorio com o build do front (apps/web/dist). */
	webDir: string;
	/** Senha do painel; vazio = sem login. */
	password: string;
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
};

function json<T>(res: ServerResponse, status: number, data: T): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(data));
}

const fail = (res: ServerResponse, status: number, message: string) => json<Api.ApiError>(res, status, { error: message });

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let raw = "";
		req.on("data", (c) => {
			raw += c;
			if (raw.length > 1_000_000) reject(new Error("corpo grande demais"));
		});
		req.on("end", () => {
			if (!raw.trim()) return resolve({});
			try {
				const parsed = JSON.parse(raw) as unknown;
				resolve(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {});
			} catch {
				reject(new Error("JSON inválido"));
			}
		});
		req.on("error", reject);
	});
}

function cookies(req: IncomingMessage): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (req.headers.cookie ?? "").split(";")) {
		const i = part.indexOf("=");
		if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
	}
	return out;
}

function sse<E extends Api.ChatEventName>(res: ServerResponse, event: E, payload: Api.ChatEvents[E]): void {
	try {
		res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
	} catch {
		/* cliente foi embora */
	}
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const chatMessage = (m: StoredMessage): Api.ChatMessage => ({
	id: m.messageId,
	author_id: m.authorId,
	author_name: m.authorName,
	content: m.body,
	reply_to: m.replyTo ?? undefined,
	is_bot: m.authorId === "bot",
	created_at: m.createdAt,
});

const memoryStatus = (status: string): Api.MemoryStatus => (status === "suppressed" ? "suppressed" : "active");

const memoryItem = (r: MemoryRecord): Api.MemoryItem => ({
	id: r.id,
	channel_id: r.channelId,
	scope: r.scope === "user" ? "user" : "group",
	user_id: r.personId || undefined,
	key: r.key,
	kind: r.kind,
	status: memoryStatus(r.status),
	content: r.content,
	version: r.versions,
	updated_at: r.updatedAt,
});

const totals = (t: MetricsTotals): Api.MetricTotals => ({
	requests: t.requests,
	failures: t.failures,
	input_tokens: t.inputTokens,
	output_tokens: t.outputTokens,
	cached_tokens: t.cachedTokens,
	cache_write_tokens: t.cacheWriteTokens,
	cache_samples: t.cacheSamples,
	cost_usd: t.costUsd,
});

export function createPanelHandler(deps: PanelServerDeps): (req: IncomingMessage, res: ServerResponse) => void {
	const { panel, chat, logger, webDir, password } = deps;
	const tokens = new Set<string>();
	const authed = (req: IncomingMessage): boolean => !password || tokens.has(cookies(req)["db_session"] ?? "");

	return (req, res) => {
		void handle(req, res).catch((e: unknown) => {
			logger.error(`painel: ${e instanceof Error ? e.message : String(e)}`);
			if (!res.headersSent) fail(res, 500, "erro interno");
			else res.end();
		});
	};

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", "http://x");
		const path = url.pathname;
		const method = req.method ?? "GET";
		if (path === "/auth/session" && method === "GET") {
			return json<Api.AuthState>(res, 200, { authenticated: authed(req) });
		}
		if (path === "/auth/login" && method === "POST") {
			const body = await readBody(req);
			if (password && body["password"] !== password) return fail(res, 401, "senha incorreta");
			const token = randomUUID();
			tokens.add(token);
			res.setHeader("Set-Cookie", `db_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
			return json<Api.AuthState>(res, 200, { authenticated: true });
		}
		if (path === "/auth/logout" && method === "POST") {
			tokens.delete(cookies(req)["db_session"] ?? "");
			return json<Api.AuthState>(res, 200, { authenticated: false });
		}
		if (path.startsWith("/api/")) {
			if (!authed(req)) return fail(res, 401, "sessão expirada — entre de novo");
			return api(url, path, method, req, res);
		}
		return serveStatic(path, res);
	}

	async function api(url: URL, path: string, method: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
		const num = (name: string) => Number(url.searchParams.get(name) ?? "") || undefined;
		if (path === "/api/meta" && method === "GET") return json<Api.Meta>(res, 200, { chat: true, agent: true, ...panel.meta() });
		if (path === "/api/logs" && method === "GET") {
			const { entries, cursor } = panel.logs(num("after") ?? 0, num("limit"));
			return json<Api.LogPage>(res, 200, { entries, next: cursor });
		}

		if (path === "/api/chat/sessions" && method === "GET") {
			const sessions = chat.list().map((s) => ({ id: s.id, title: s.title, updated_at: s.updatedAt, messages: s.messages }));
			return json<Api.ChatSessionList>(res, 200, { sessions });
		}
		let m = /^\/api\/chat\/sessions\/([^/]+)\/messages$/.exec(path);
		if (m) {
			const id = m[1] ?? "";
			if (!WebChat.validId(id)) return fail(res, 400, "sessão inválida");
			if (method === "GET") return json<Api.ChatHistory>(res, 200, { messages: chat.history(id).map(chatMessage) });
			if (method !== "POST") return fail(res, 405, "método não permitido");
			const content = str((await readBody(req))["content"]) ?? "";
			if (!content.trim()) return fail(res, 400, "mensagem vazia");
			return streamChat(id, content, res);
		}
		m = /^\/api\/chat\/sessions\/([^/]+)$/.exec(path);
		if (m && method === "DELETE") {
			const id = m[1] ?? "";
			if (!WebChat.validId(id)) return fail(res, 400, "sessão inválida");
			chat.remove(id);
			res.writeHead(204);
			res.end();
			return;
		}

		if (path === "/api/memories" && method === "GET") {
			return json<Api.MemoryList>(res, 200, { items: panel.memories(num("limit")).map(memoryItem) });
		}
		m = /^\/api\/memories\/(\d+)\/versions$/.exec(path);
		if (m && method === "GET") {
			const found = panel.memoryVersions(Number(m[1]));
			if (!found) return fail(res, 404, "memória não encontrada");
			const versions = found.versions.map((v) => ({
				version: v.id,
				kind: found.memory.kind,
				status: memoryStatus(found.memory.status),
				content: v.content,
				reason: v.reason,
				created_at: v.createdAt,
			}));
			return json<Api.MemoryVersionList>(res, 200, { versions });
		}
		m = /^\/api\/memories\/(\d+)\/(forget|restore)$/.exec(path);
		if (m && method === "POST") {
			const reason = str((await readBody(req))["reason"]);
			const changed = m[2] === "forget" ? panel.forget(Number(m[1]), reason) : panel.restore(Number(m[1]), reason);
			return changed ? json<Api.Changed>(res, 200, { changed: true }) : fail(res, 404, "memória não encontrada");
		}
		m = /^\/api\/memories\/(\d+)$/.exec(path);
		if (m && method === "PUT") {
			const body = await readBody(req);
			const content = str(body["content"]) ?? "";
			if (!content.trim()) return fail(res, 400, "conteúdo vazio");
			return panel.correct(Number(m[1]), content, str(body["reason"]))
				? json<Api.Changed>(res, 200, { changed: true })
				: fail(res, 404, "memória não encontrada");
		}

		if (path === "/api/learnings" && method === "GET") {
			const events = panel
				.learnings(num("limit"))
				.map((e) => ({ at: e.at, kind: e.kind, channel_id: e.channelId, subject: e.subject, detail: e.detail }));
			return json<Api.LearningList>(res, 200, { events });
		}
		if (path === "/api/metrics" && method === "GET") return json<Api.MetricsSnapshot>(res, 200, metricsJson());

		if (path === "/api/config/discord" && method === "GET") return json<Api.DiscordConfig>(res, 200, panel.discordForm());
		if (path === "/api/config/discord" && method === "PUT") {
			const body = await readBody(req);
			panel.saveDiscordForm({
				guild_id: str(body["guild_id"]) ?? "",
				channel_ids: strArr(body["channel_ids"]),
				admin_ids: strArr(body["admin_ids"]),
				web_user_id: str(body["web_user_id"]),
				personality: str(body["personality"]),
			});
			return json<Api.Saved>(res, 200, { saved: true, restart_required: true });
		}

		// Participacao (fase futura): stubs para o front nao quebrar.
		if (path === "/api/participation" && method === "GET") return json<Api.ParticipationList>(res, 200, { items: [] });
		if (path.startsWith("/api/participation/") && method === "POST") return json<Api.Changed>(res, 200, { changed: true });

		if (path === "/api/models" && method === "GET") return json<Api.ModelCatalog>(res, 200, { models: [], model: panel.model() });
		if (path === "/api/model" && method === "PUT") {
			const model = str((await readBody(req))["model"]) ?? "";
			panel.setModel(model);
			return json<Api.ModelChanged>(res, 200, { model, restart_required: false });
		}
		return fail(res, 404, "rota desconhecida");
	}

	function metricsJson(): Api.MetricsSnapshot {
		const { totals: t, byModel, recent } = panel.metrics();
		return {
			summary: totals(t),
			models: byModel.map((mm) => ({
				...totals(mm),
				provider: mm.provider,
				model: mm.model,
				operation: mm.operation,
				source: mm.source,
				avg_latency_ms: mm.avgLatencyMs,
			})),
			recent: recent.map((r) => ({
				id: r.id,
				started_at: r.startedAt,
				duration_ms: r.durationMs,
				operation: r.operation,
				source: r.source,
				provider: r.provider,
				model: r.model,
				success: r.success,
				input_tokens: r.inputTokens,
				output_tokens: r.outputTokens,
				total_tokens: r.inputTokens !== null && r.outputTokens !== null ? r.inputTokens + r.outputTokens : null,
				cached_tokens: r.cachedTokens,
				cache_write_tokens: r.cacheWriteTokens,
				cost_usd: r.costUsd,
			})),
			refresh_ms: 5000,
		};
	}

	/** SSE: accepted (pergunta gravada), step (cada tool), done (resposta) ou error. */
	async function streamChat(id: string, content: string, res: ServerResponse): Promise<void> {
		res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
		const steps: Api.ChatStep[] = [];
		try {
			const bot = await chat.send(id, content, {
				accepted: (message) => sse(res, "accepted", { message: chatMessage(message) }),
				step: (s) => {
					const step = { tool: s.tool, args: s.args, output: s.output, duration_ms: s.durationMs };
					steps.push(step);
					sse(res, "step", step);
				},
			});
			sse(res, "done", { message: chatMessage(bot), steps });
		} catch (e: unknown) {
			sse(res, "error", { message: e instanceof Error ? e.message : String(e) });
		} finally {
			res.end();
		}
	}

	async function serveStatic(path: string, res: ServerResponse): Promise<void> {
		let rel = decodeURIComponent(path);
		if (rel.endsWith("/")) rel += "index.html";
		const file = normalize(join(webDir, rel));
		if (!file.startsWith(webDir + sep) && file !== join(webDir, "index.html")) {
			res.writeHead(403);
			res.end();
			return;
		}
		for (const candidate of [file, join(webDir, "index.html")]) {
			try {
				const data = await readFile(candidate);
				res.writeHead(200, { "Content-Type": CONTENT_TYPES[candidate.slice(candidate.lastIndexOf("."))] ?? "application/octet-stream" });
				res.end(data);
				return;
			} catch {
				/* tenta o fallback SPA */
			}
		}
		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
<h1>Painel sem build</h1>
<p>Rode <code>bun run build</code> na raiz do repo.</p>
</body></html>`);
	}
}

export function startPanel(deps: PanelServerDeps, port: number, host: string): Server {
	const server = createServer(createPanelHandler(deps));
	server.listen(port, host);
	return server;
}
