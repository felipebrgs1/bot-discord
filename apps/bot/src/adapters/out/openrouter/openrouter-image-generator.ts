/**
 * ImageGenerator pelo endpoint images do OpenRouter.
 * A imagem volta em data[].b64_json, com media_type opcional.
 */

import type { ImageGenerator } from "../../../application/ports/image-generator.ts";
import type { ImageData } from "../../../domain/image.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/images";
const TIMEOUT_MS = 180_000;

export interface OpenRouterImageOptions {
	http: typeof fetch;
	apiKey: string;
	/** Id do modelo no OpenRouter, ex.: inclusionai/ming-image-0.1-design. */
	model: string;
}

interface Completion {
	error?: { message?: unknown };
	data?: { b64_json?: unknown; media_type?: unknown }[];
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
			body: JSON.stringify({ model: this.opts.model, prompt, output_format: "png" }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = await res.text();
		const json = parse(body);
		const detail = typeof json?.error?.message === "string" ? json.error.message : undefined;
		if (!res.ok) throw new Error(`openrouter ${res.status}: ${detail ?? body.slice(0, 300)}`);
		if (detail) throw new Error(`openrouter: ${detail}`);

		const image = json?.data?.[0];
		if (typeof image?.b64_json === "string" && image.b64_json) {
			return {
				data: image.b64_json,
				mimeType: typeof image.media_type === "string" && image.media_type ? image.media_type : "image/png",
			};
		}
		throw new Error("sem imagem na resposta: o modelo não gerou nada");
	}
}
