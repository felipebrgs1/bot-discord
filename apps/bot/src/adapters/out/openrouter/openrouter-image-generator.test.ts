import { describe, expect, it } from "bun:test";
import { OpenRouterImageGenerator } from "./openrouter-image-generator.ts";

interface Call {
	url: string;
	init: RequestInit;
}

function fakeHttp(status: number, body: unknown) {
	const calls: Call[] = [];
	const http = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response(JSON.stringify(body), { status });
	}) as typeof fetch;
	return { http, calls };
}

function generator(http: typeof fetch) {
	return new OpenRouterImageGenerator({ http, apiKey: "or-k", model: "inclusionai/ming-image-0.1-design" });
}

describe("OpenRouterImageGenerator", () => {
	it("pede imagem ao endpoint images com a chave, modelo e prompt", async () => {
		const { http, calls } = fakeHttp(200, { data: [{ b64_json: "aW1n" }] });
		await generator(http).generate("um gato");
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.url).toBe("https://openrouter.ai/api/v1/images");
		expect(call?.init.method).toBe("POST");
		expect(new Headers(call?.init.headers).get("authorization")).toBe("Bearer or-k");
		expect(JSON.parse(String(call?.init.body))).toEqual({ model: "inclusionai/ming-image-0.1-design", prompt: "um gato", output_format: "png" });
	});

	it("devolve a primeira imagem em base64 com o tipo dela", async () => {
		const { http } = fakeHttp(200, { data: [{ b64_json: "eA==", media_type: "image/jpeg" }, { b64_json: "aW1n" }] });
		expect(await generator(http).generate("gato")).toEqual({ data: "eA==", mimeType: "image/jpeg" });
	});

	it("usa png solicitado quando a resposta omite o tipo", async () => {
		const { http } = fakeHttp(200, { data: [{ b64_json: "aW1n" }] });
		expect(await generator(http).generate("gato")).toEqual({ data: "aW1n", mimeType: "image/png" });
	});

	it("status de erro vira mensagem com o detalhe do servidor", async () => {
		const { http } = fakeHttp(402, { error: { message: "Insufficient credits" } });
		await expect(generator(http).generate("gato")).rejects.toThrow("openrouter 402: Insufficient credits");
	});

	it("erro dentro de resposta 200 tambem vira mensagem", async () => {
		const { http } = fakeHttp(200, { error: { message: "provider caiu" } });
		await expect(generator(http).generate("gato")).rejects.toThrow("openrouter: provider caiu");
	});

	it("resposta sem imagem vira erro", async () => {
		const { http } = fakeHttp(200, { data: [] });
		await expect(generator(http).generate("gato")).rejects.toThrow("sem imagem na resposta");
	});

	it("sem chave nem chega a chamar", async () => {
		const { http, calls } = fakeHttp(200, { data: [{ b64_json: "aW1n" }] });
		const gen = new OpenRouterImageGenerator({ http, apiKey: "", model: "m" });
		await expect(gen.generate("gato")).rejects.toThrow("OPENROUTER_API_KEY não definido");
		expect(calls).toHaveLength(0);
	});
});
