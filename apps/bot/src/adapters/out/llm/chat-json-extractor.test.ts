import { describe, expect, it } from "bun:test";
import { ChatJsonExtractor } from "./chat-json-extractor.ts";

function recorder(status: number, content: string) {
	const calls: { url: string; init: RequestInit }[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });
	}) as typeof fetch;
	return { calls, http };
}

describe("ChatJsonExtractor", () => {
	it("posta o prompt pedindo json e devolve o conteudo parseado", async () => {
		const { calls, http } = recorder(200, '{"summary":"s"}');
		const extractor = new ChatJsonExtractor({ baseUrl: "https://api.x/v1/", apiKey: "k", model: "m", http });
		expect(await extractor.complete("extraia")).toEqual({ summary: "s" });
		expect(calls[0]?.url).toBe("https://api.x/v1/chat/completions");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers["Authorization"]).toBe("Bearer k");
		expect(headers["x-opencode-session"]).toMatch(/^[0-9a-f-]{36}$/);
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body).toEqual({
			model: "m",
			messages: [{ role: "user", content: "extraia" }],
			response_format: { type: "json_object" },
		});
	});

	it("HTTP de erro vira excecao com o status", async () => {
		const { http } = recorder(400, "{}");
		const extractor = new ChatJsonExtractor({ baseUrl: "https://api.x", apiKey: "k", model: "m", http });
		await expect(extractor.complete("p")).rejects.toThrow("extração HTTP 400");
	});
});
