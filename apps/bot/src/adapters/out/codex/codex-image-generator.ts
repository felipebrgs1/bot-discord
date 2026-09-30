/**
 * ImageGenerator pela assinatura do ChatGPT: o endpoint de Responses do Codex
 * com a tool image_generation (gpt-image), usando o token OAuth do login do pi.
 */

import type { ImageGenerator } from "../../../application/ports/image-generator.ts";
import type { ImageData } from "../../../domain/image.ts";

const ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const ACCOUNT_CLAIM = "https://api.openai.com/auth";
/** Imagem de alta qualidade leva mais de um minuto. */
const TIMEOUT_MS = 180_000;

export interface CodexImageOptions {
	http: typeof fetch;
	/** Access token OAuth do openai-codex (renovado por quem fornece). */
	token: () => Promise<string>;
	/** Modelo de chat que chama a tool, ex.: gpt-5.5. */
	model: string;
}

type Event = Record<string, unknown>;

function accountIdOf(token: string): string {
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
		const claim = payload[ACCOUNT_CLAIM] as { chatgpt_account_id?: unknown } | undefined;
		if (typeof claim?.chatgpt_account_id === "string" && claim.chatgpt_account_id) return claim.chatgpt_account_id;
	} catch {
		/* tratado abaixo */
	}
	throw new Error("token do Codex inválido: faça /login de novo no pi");
}

function eventsOf(body: string): Event[] {
	const events: Event[] = [];
	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		try {
			events.push(JSON.parse(line.slice(6)) as Event);
		} catch {
			/* linha que nao e JSON (keepalive, [DONE]) */
		}
	}
	return events;
}

function errorDetail(body: string): string {
	try {
		const j = JSON.parse(body) as { detail?: unknown; error?: { message?: unknown } };
		if (typeof j.detail === "string") return j.detail;
		if (typeof j.error?.message === "string") return j.error.message;
	} catch {
		/* corpo nao e JSON */
	}
	return body.slice(0, 300);
}

export class CodexImageGenerator implements ImageGenerator {
	private readonly opts: CodexImageOptions;

	constructor(opts: CodexImageOptions) {
		this.opts = opts;
	}

	async generate(prompt: string): Promise<ImageData> {
		const token = await this.opts.token();
		const res = await this.opts.http(ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"chatgpt-account-id": accountIdOf(token),
				originator: "pi",
				"OpenAI-Beta": "responses=experimental",
				accept: "text/event-stream",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: this.opts.model,
				store: false,
				stream: true,
				instructions: "Generate the image the user describes. Follow the description faithfully.",
				input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
				tools: [{ type: "image_generation", output_format: "png" }],
				tool_choice: { type: "image_generation" },
			}),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		const body = await res.text();
		if (!res.ok) throw new Error(`codex ${res.status}: ${errorDetail(body)}`);

		let text = "";
		for (const e of eventsOf(body)) {
			if (e["type"] === "response.failed" || e["type"] === "error") {
				const response = e["response"] as { error?: { message?: unknown } } | undefined;
				const message = response?.error?.message ?? e["message"];
				throw new Error(typeof message === "string" ? message : "geração falhou");
			}
			if (e["type"] === "response.output_text.done" && typeof e["text"] === "string") text += e["text"];
			const item = e["item"] as { type?: unknown; result?: unknown; output_format?: unknown } | undefined;
			if (e["type"] === "response.output_item.done" && item?.type === "image_generation_call" && typeof item.result === "string" && item.result) {
				const format = typeof item.output_format === "string" ? item.output_format : "png";
				return { data: item.result, mimeType: `image/${format}` };
			}
		}
		throw new Error(`sem imagem na resposta: ${text.trim() || "o modelo não gerou nada"}`);
	}
}
