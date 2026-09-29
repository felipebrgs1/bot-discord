/** LearningExtractor via endpoint de chat OpenAI-compatible (response_format json_object). */

import { randomUUID } from "node:crypto";
import type { LearningExtractor } from "../../../application/ports/learning-extractor.ts";

export interface ChatJsonOptions {
	baseUrl: string;
	apiKey: string;
	model: string;
	http?: typeof fetch;
	timeoutMs?: number;
}

export class ChatJsonExtractor implements LearningExtractor {
	private readonly opts: ChatJsonOptions;

	constructor(opts: ChatJsonOptions) {
		this.opts = opts;
	}

	async complete(prompt: string): Promise<unknown> {
		const http = this.opts.http ?? fetch;
		const res = await http(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.opts.apiKey}`,
				// O endpoint zen (opencode-go) exige sessao p/ rotear; sem ela da 400.
				"x-opencode-session": randomUUID(),
			},
			body: JSON.stringify({
				model: this.opts.model,
				messages: [{ role: "user", content: prompt }],
				response_format: { type: "json_object" },
			}),
			signal: AbortSignal.timeout(this.opts.timeoutMs ?? 80_000),
		});
		if (!res.ok) throw new Error(`extração HTTP ${res.status}`);
		const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
		return JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as unknown;
	}
}
