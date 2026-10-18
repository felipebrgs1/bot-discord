/** LearningExtractor via protocolo Anthropic (POST /messages). Para modelos que nao falam chat/completions, ex.: claude-haiku-5-5 no OpenCode Go. */

import { randomUUID } from "node:crypto";
import type { LearningExtractor } from "@/application/ports/learning-extractor.ts";

export interface AnthropicJsonOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
	http?: typeof fetch;
	timeoutMs?: number;
}

interface MessageResponse {
	content?: { type: string; text?: string }[];
}

export class AnthropicJsonExtractor implements LearningExtractor {
	private readonly opts: AnthropicJsonOptions;

	constructor(opts: AnthropicJsonOptions) {
		this.opts = opts;
	}

	async complete(prompt: string): Promise<unknown> {
		const http = this.opts.http ?? fetch;
		const res = await http(`${this.opts.baseUrl.replace(/\/$/, "")}/messages`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-api-key": this.opts.apiKey,
				"anthropic-version": "2023-06-01",
				// O endpoint zen (opencode-go) exige sessao p/ rotear; sem ela da 400.
				"x-opencode-session": randomUUID(),
			},
			body: JSON.stringify({
				model: this.opts.model,
				max_tokens: 4096,
				messages: [{ role: "user", content: prompt }],
			}),
			signal: AbortSignal.timeout(this.opts.timeoutMs ?? 80_000),
		});
		if (!res.ok) throw new Error(`extração HTTP ${res.status}`);
		const data = (await res.json()) as MessageResponse;
		const text = (data.content ?? []).map((b) => (b.type === "text" ? (b.text ?? "") : "")).join("");
		return JSON.parse(extractJson(text)) as unknown;
	}
}

/** Modelo nao usa response_format: pega o trecho entre a primeira { e a ultima }. */
function extractJson(text: string): string {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	return start >= 0 && end > start ? text.slice(start, end + 1) : "{}";
}
