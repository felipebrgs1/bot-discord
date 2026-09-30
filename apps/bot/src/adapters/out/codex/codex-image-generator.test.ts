import { describe, expect, it } from "bun:test";
import { CodexImageGenerator } from "./codex-image-generator.ts";

/** JWT sem assinatura valida: o adapter so le o claim da conta. */
function jwt(claims: Record<string, unknown>): string {
	const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
	return `${part({ alg: "none" })}.${part(claims)}.assinatura`;
}

const TOKEN = jwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acc-1" } });

function sse(...events: Record<string, unknown>[]): string {
	return events.map((e) => `event: ${String(e["type"])}\ndata: ${JSON.stringify(e)}\n\n`).join("");
}

const imageDone = (result: string, format = "png") => ({
	type: "response.output_item.done",
	item: { type: "image_generation_call", status: "completed", output_format: format, result },
});

interface Call {
	url: string;
	init: RequestInit;
}

function fakeHttp(status: number, body: string) {
	const calls: Call[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(body, { status });
	}) as typeof fetch;
	return { http, calls };
}

function generator(http: typeof fetch, token = TOKEN) {
	return new CodexImageGenerator({ http, token: async () => token, model: "gpt-5.5" });
}

describe("CodexImageGenerator", () => {
	it("pede a tool image_generation ao endpoint do Codex com o token da assinatura", async () => {
		const { http, calls } = fakeHttp(200, sse({ type: "response.created" }, imageDone("aW1n"), { type: "response.completed" }));
		await generator(http).generate("um gato");
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.url).toBe("https://chatgpt.com/backend-api/codex/responses");
		expect(call?.init.method).toBe("POST");
		const headers = new Headers(call?.init.headers);
		expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
		expect(headers.get("chatgpt-account-id")).toBe("acc-1");
		const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
		expect(body["model"]).toBe("gpt-5.5");
		expect(body["stream"]).toBe(true);
		expect(body["store"]).toBe(false);
		expect(body["tools"]).toEqual([{ type: "image_generation", output_format: "png" }]);
		expect(body["tool_choice"]).toEqual({ type: "image_generation" });
		expect(JSON.stringify(body["input"])).toContain("um gato");
	});

	it("devolve a imagem em base64 com o tipo do formato gerado", async () => {
		const { http } = fakeHttp(200, sse(imageDone("aW1n", "webp"), { type: "response.completed" }));
		expect(await generator(http).generate("gato")).toEqual({ data: "aW1n", mimeType: "image/webp" });
	});

	it("status de erro vira mensagem com o detalhe do servidor", async () => {
		const { http } = fakeHttp(429, JSON.stringify({ detail: "limite de uso atingido" }));
		await expect(generator(http).generate("gato")).rejects.toThrow("codex 429: limite de uso atingido");
	});

	it("response.failed vira erro com a mensagem do modelo", async () => {
		const { http } = fakeHttp(200, sse({ type: "response.failed", response: { error: { message: "moderação bloqueou" } } }));
		await expect(generator(http).generate("gato")).rejects.toThrow("moderação bloqueou");
	});

	it("resposta sem imagem devolve o texto do modelo como erro", async () => {
		const { http } = fakeHttp(
			200,
			sse({ type: "response.output_text.done", text: "não posso gerar isso" }, { type: "response.completed" }),
		);
		await expect(generator(http).generate("gato")).rejects.toThrow("sem imagem na resposta: não posso gerar isso");
	});

	it("token sem conta do ChatGPT nem chega a chamar", async () => {
		const { http, calls } = fakeHttp(200, "");
		await expect(generator(http, "nao-e-jwt").generate("gato")).rejects.toThrow("token do Codex inválido");
		expect(calls).toHaveLength(0);
	});
});
