/**
 * ImageGenerator pelo OpenRouter: chat completions com modalities ["image"]
 * (modelos so de imagem). A imagem volta como data URL em message.images.
 */

import type { ImageGenerator } from "../../../application/ports/image-generator.ts";
import type { ImageData } from "../../../domain/image.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS = 180_000;

export interface OpenRouterImageOptions {
	http: typeof fetch;
	apiKey: string;
	/** Id do modelo no OpenRouter, ex.: inclusionai/ming-image-0.1-design. */
	model: string;
}

interface Completion {
	error?: { message?: unknown };
	choices?: { message?: { content?: unknown; images?: { image_url?: { url?: unknown } }[] } }[];
}

function parse(body: string): Completion | undefined {
	try {
		return JSON.parse(body) as Completion;
	} catch {
		return undefined;
	}
}

export class OpenRouterImageGenerator implements ImageGenerator {
	private readonly opts: OpenRouterImageOptions;

	constructor(opts: OpenRouterImageOptions) {
		this.opts = opts;
	}

	async generate(prompt: string): Promise<ImageData> {
		if (!this.opts.apiKey) throw new Error("OPENROUTER_API_KEY não definido no .env");
		const res = await this.opts.http(ENDPOINT, {
			method: "POST",
			headers: { Authorization: `Bearer ${this.opts.apiKey}`, "content-type": "application/json" },
			body: JSON.stringify({ model: this.opts.model, modalities: ["image"], messages: [{ role: "user", content: prompt }] }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = await res.text();
		const json = parse(body);
		const detail = typeof json?.error?.message === "string" ? json.error.message : undefined;
		if (!res.ok) throw new Error(`openrouter ${res.status}: ${detail ?? body.slice(0, 300)}`);
		if (detail) throw new Error(`openrouter: ${detail}`);

		const message = json?.choices?.[0]?.message;
		const url = message?.images?.[0]?.image_url?.url;
		const match = typeof url === "string" ? /^data:([^;,]+);base64,(.+)$/s.exec(url) : null;
		if (match?.[1] && match[2]) return { data: match[2], mimeType: match[1] };
		const text = typeof message?.content === "string" ? message.content.trim() : "";
		throw new Error(`sem imagem na resposta: ${text || "o modelo não gerou nada"}`);
	}
}
