import { describe, expect, it } from "bun:test";
import type { ChatMessage, ChatStep } from "@elmatadore/api";
import { createApi, type Fetch } from "./client.ts";

interface Call {
	url: string;
	init: RequestInit | undefined;
}

/** fetch falso: responde pela ordem da fila e grava as chamadas. */
function fakeFetch(...responses: Array<Response | (() => Promise<Response>)>) {
	const calls: Call[] = [];
	const fetch: Fetch = async (url, init) => {
		calls.push({ url, init });
		const next = responses.shift();
		if (!next) throw new Error(`chamada inesperada: ${url}`);
		return typeof next === "function" ? next() : next;
	};
	return { calls, fetch };
}

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

function sse(...frames: string[]): Response {
	const bytes = new TextEncoder().encode(frames.join(""));
	const body = new ReadableStream({
		start(c) {
			c.enqueue(bytes);
			c.close();
		},
	});
	return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function setup(...responses: Array<Response | (() => Promise<Response>)>) {
	const { calls, fetch } = fakeFetch(...responses);
	let expired = 0;
	const api = createApi({ fetch, onUnauthorized: () => void expired++ });
	return { api, calls, expired: () => expired };
}

const message = (id: string, content: string, is_bot = false): ChatMessage => ({
	id,
	author_id: is_bot ? "bot" : "web",
	author_name: is_bot ? "bot" : "voce",
	content,
	is_bot,
	created_at: "2026-09-29T12:00:00.000Z",
});

describe("createApi: requisicoes", () => {
	it("GET devolve o corpo tipado e nunca usa cache", async () => {
		const { api, calls } = setup(json({ chat: true, agent: true, model: "m", role: "admin" }));
		expect(await api.meta()).toEqual({ chat: true, agent: true, model: "m", role: "admin" });
		expect(calls[0]?.url).toBe("/api/meta");
		expect(calls[0]?.init?.cache).toBe("no-store");
	});

	it("PUT manda JSON com o corpo do contrato", async () => {
		const { api, calls } = setup(json({ changed: true }));
		await api.correctMemory(7, "novo", "motivo");
		expect(calls[0]?.url).toBe("/api/memories/7");
		expect(calls[0]?.init?.method).toBe("PUT");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ content: "novo", reason: "motivo" });
	});

	it("codifica o id da sessao na rota", async () => {
		const { api, calls } = setup(new Response(null, { status: 204 }));
		await api.deleteSession("a/b");
		expect(calls[0]?.url).toBe("/api/chat/sessions/a%2Fb");
	});

	it("erro HTTP vira Error com a mensagem do servidor", async () => {
		const { api } = setup(json({ error: "memória não encontrada" }, 404));
		await expect(api.memoryVersions(9)).rejects.toThrow("memória não encontrada");
	});

	it("HTML no lugar de JSON explica que a rota nao existe no backend", async () => {
		const { api } = setup(new Response("<!doctype html><html></html>", { status: 200 }));
		await expect(api.meta()).rejects.toThrow("HTML em vez de JSON");
	});

	it("falha de rede vira mensagem de conexao", async () => {
		const { api } = setup(() => Promise.reject(new TypeError("fetch failed")));
		await expect(api.meta()).rejects.toThrow("sem conexão com o servidor");
	});

	it("401 em /api avisa sessao expirada", async () => {
		const { api, expired } = setup(json({ error: "sessão expirada" }, 401));
		await api.meta().catch(() => undefined);
		expect(expired()).toBe(1);
	});

	it("401 no login e senha errada, nao sessao expirada", async () => {
		const { api, expired } = setup(json({ error: "senha incorreta" }, 401));
		await expect(api.login("x")).rejects.toThrow("senha incorreta");
		expect(expired()).toBe(0);
	});

	it("session le authenticated do bot ou do Worker", async () => {
		const { api } = setup(json({ authenticated: false }));
		expect(await api.session()).toBe(false);
	});
});

describe("createApi: chat por SSE", () => {
	function handlers() {
		const seen: string[] = [];
		return {
			seen,
			on: {
				accepted: (m: ChatMessage) => void seen.push(`accepted:${m.id}`),
				step: (s: ChatStep) => void seen.push(`step:${s.tool}`),
				done: (m: ChatMessage, steps: ChatStep[]) => void seen.push(`done:${m.content}:${steps.length}`),
				error: (text: string) => void seen.push(`error:${text}`),
			},
		};
	}

	it("dispara accepted, step e done em ordem", async () => {
		const { api, calls } = setup(
			sse(
				`event: accepted\ndata: ${JSON.stringify({ message: message("u1", "oi") })}\n\n`,
				`event: step\ndata: ${JSON.stringify({ tool: "web_search", args: "{}", output: "x", duration_ms: 3 })}\n\n`,
				`event: done\ndata: ${JSON.stringify({ message: message("b1", "resposta", true), steps: [] })}\n\n`,
			),
		);
		const h = handlers();
		await api.sendChat("s1", "oi", h.on);
		expect(h.seen).toEqual(["accepted:u1", "step:web_search", "done:resposta:0"]);
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ content: "oi" });
	});

	it("quadro malformado e pulado sem derrubar o resto", async () => {
		const { api } = setup(
			sse("event: step\ndata: NAO-JSON\n\n", `event: done\ndata: ${JSON.stringify({ message: message("b1", "fim", true), steps: [] })}\n\n`),
		);
		const h = handlers();
		await api.sendChat("s1", "oi", h.on);
		expect(h.seen).toEqual(["done:fim:0"]);
	});

	it("evento error e erro HTTP viram error", async () => {
		const a = setup(sse(`event: error\ndata: {"message":"modelo caiu"}\n\n`));
		const h1 = handlers();
		await a.api.sendChat("s1", "oi", h1.on);
		expect(h1.seen).toEqual(["error:modelo caiu"]);

		const b = setup(json({ error: "mensagem vazia" }, 400));
		const h2 = handlers();
		await b.api.sendChat("s1", " ", h2.on);
		expect(h2.seen).toEqual(["error:mensagem vazia"]);
	});

	it("stream que termina sem done nem error avisa", async () => {
		const { api } = setup(sse(`event: accepted\ndata: ${JSON.stringify({ message: message("u1", "oi") })}\n\n`));
		const h = handlers();
		await api.sendChat("s1", "oi", h.on);
		expect(h.seen).toEqual(["accepted:u1", "error:o servidor encerrou a resposta sem concluir"]);
	});

	it("cancelar nao chama error", async () => {
		const ctl = new AbortController();
		const { api } = setup(
			() =>
				new Promise<Response>((_, reject) => {
					ctl.signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError")));
				}),
		);
		const h = handlers();
		const pending = api.sendChat("s1", "oi", { ...h.on, signal: ctl.signal });
		ctl.abort();
		await pending;
		expect(h.seen).toEqual([]);
	});
});
