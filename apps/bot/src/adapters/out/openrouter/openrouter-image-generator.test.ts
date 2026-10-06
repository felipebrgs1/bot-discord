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
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
	}) as typeof fetch;
	return { http, calls };
}

const withImages = (...urls: string[]) => ({
	choices: [{ message: { role: "assistant", content: "", images: urls.map((url) => ({ type: "image_url", image_url: { url } })) } }],
});

function generator(http: typeof fetch) {
	return new OpenRouterImageGenerator({ http, apiKey: "or-k", model: "inclusionai/ming-image-0.1-design" });
}

describe("OpenRouterImageGenerator", () => {
	it("pede imagem ao chat completions do OpenRouter com a chave e o modelo", async () => {
		const { http, calls } = fakeHttp(200, withImages("data:image/png;base64,aW1n"));
		await generator(http).generate("um gato");
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(call?.init.method).toBe("POST");
		expect(new Headers(call?.init.headers).get("authorization")).toBe("Bearer or-k");
		const body = JSON.parse(String(call?.init.body)) as Record<string, unknown>;
		expect(body["model"]).toBe("inclusionai/ming-image-0.1-design");
		expect(body["modalities"]).toEqual(["image"]);
		expect(body["messages"]).toEqual([{ role: "user", content: "um gato" }]);
	});

	it("devolve a primeira imagem do data URL em base64 com o tipo dela", async () => {
		const { http } = fakeHttp(200, withImages("data:image/jpeg;base64,eA==", "data:image/png;base64,aW1n"));
		expect(await generator(http).generate("gato")).toEqual({ data: "eA==", mimeType: "image/jpeg" });
	});

	it("status de erro vira mensagem com o detalhe do servidor", async () => {
		const { http } = fakeHttp(402, { error: { message: "Insufficient credits" } });
		await expect(generator(http).generate("gato")).rejects.toThrow("openrouter 402: Insufficient credits");
	});

	it("erro dentro de resposta 200 tambem vira mensagem", async () => {
		const { http } = fakeHttp(200, { error: { message: "provider caiu" } });
		await expect(generator(http).generate("gato")).rejects.toThrow("openrouter: provider caiu");
	});

	it("resposta sem imagem devolve o texto do modelo como erro", async () => {
		const { http } = fakeHttp(200, { choices: [{ message: { content: "não posso gerar isso" } }] });
		await expect(generator(http).generate("gato")).rejects.toThrow("sem imagem na resposta: não posso gerar isso");
	});

	it("sem chave nem chega a chamar", async () => {
		const { http, calls } = fakeHttp(200, withImages("data:image/png;base64,aW1n"));
		const gen = new OpenRouterImageGenerator({ http, apiKey: "", model: "m" });
		await expect(gen.generate("gato")).rejects.toThrow("OPENROUTER_API_KEY não definido");
		expect(calls).toHaveLength(0);
	});
});
