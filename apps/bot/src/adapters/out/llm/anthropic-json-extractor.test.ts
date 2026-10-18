import { describe, expect, it } from "bun:test";
import { AnthropicJsonExtractor } from "./anthropic-json-extractor.ts";

function recorder(status: number, body: unknown) {
	const calls: { url: string; init: RequestInit }[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { calls, http };
}

const ok = (text: string) => ({ content: [{ type: "text", text }] });

describe("AnthropicJsonExtractor", () => {
	it("posta em /messages com x-api-key e devolve o JSON do texto da resposta", async () => {
		const { calls, http } = recorder(200, ok('{"summary":"s"}'));
		const extractor = new AnthropicJsonExtractor({ baseUrl: "https://api.x/v1/", apiKey: "k", model: "m", http });
		expect(await extractor.complete("extraia")).toEqual({ summary: "s" });
		expect(calls[0]?.url).toBe("https://api.x/v1/messages");
		const headers = calls[0]?.init.headers as Record<string, string>;
		expect(headers["x-api-key"]).toBe("k");
		expect(headers["anthropic-version"]).toBe("2023-06-01");
		expect(headers["x-opencode-session"]).toMatch(/^[0-9a-f-]{36}$/);
		const body = JSON.parse(String(calls[0]?.init.body));
		expect(body.model).toBe("m");
		expect(body.messages).toEqual([{ role: "user", content: "extraia" }]);
		expect(body.max_tokens).toBeGreaterThan(0);
	});

	it("tolera JSON cercado por bloco de codigo", async () => {
		const { http } = recorder(200, ok('Aqui:\n```json\n{"a":1}\n```'));
		const extractor = new AnthropicJsonExtractor({ baseUrl: "https://api.x", apiKey: "k", model: "m", http });
		expect(await extractor.complete("p")).toEqual({ a: 1 });
	});

	it("HTTP de erro vira excecao com o status", async () => {
		const { http } = recorder(400, {});
		const extractor = new AnthropicJsonExtractor({ baseUrl: "https://api.x", apiKey: "k", model: "m", http });
		await expect(extractor.complete("p")).rejects.toThrow("extração HTTP 400");
	});
});
