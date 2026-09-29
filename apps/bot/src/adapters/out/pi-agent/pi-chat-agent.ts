/** ChatAgent + ChatSessions sobre o SessionPool: metricas por turno e passos de tool. */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ChatAgent, ChatRequest, ChatSessions, ToolStep } from "../../../application/ports/chat-agent.ts";
import type { MetricsSink } from "../../../application/ports/metrics.ts";
import type { TurnReport } from "../../../domain/turn.ts";
import type { SessionPool } from "./session-pool.ts";

export interface StatsTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/** Totais acumulados da sessao (getSessionStats do SDK); null se indisponivel. */
export function statsOf(session: unknown): StatsTotals | null {
	try {
		const s = session as { getSessionStats?: () => unknown };
		if (typeof s.getSessionStats !== "function") return null;
		const stats = s.getSessionStats() as {
			tokens?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
			cost?: unknown;
		};
		const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		return {
			input: num(stats.tokens?.input),
			output: num(stats.tokens?.output),
			cacheRead: num(stats.tokens?.cacheRead),
			cacheWrite: num(stats.tokens?.cacheWrite),
			cost: num(stats.cost),
		};
	} catch {
		return null;
	}
}

/** Modelo que respondeu de fato (a sessao sabe; config e so o pedido). */
function actualModel(session: AgentSession): { id: string; provider: string } {
	try {
		const m = (session as unknown as { model?: { id?: unknown; provider?: unknown } }).model;
		return {
			id: typeof m?.id === "string" ? m.id : "",
			provider: typeof m?.provider === "string" ? m.provider : "",
		};
	} catch {
		return { id: "", provider: "" };
	}
}

/** Turno para a metrica: delta de tokens/custo da sessao e o modelo real. */
export function turnReport(
	session: AgentSession,
	before: StatsTotals | null,
	turn: Pick<TurnReport, "operation" | "source" | "status" | "latencyMs">,
	fallbackModel: string,
): TurnReport {
	const after = statsOf(session);
	const delta = (f: (s: StatsTotals) => number) => (before && after ? Math.max(0, f(after) - f(before)) : null);
	const model = actualModel(session);
	return {
		...turn,
		model: model.id || fallbackModel,
		provider: model.provider,
		inputTokens: delta((s) => s.input),
		outputTokens: delta((s) => s.output),
		cachedTokens: delta((s) => s.cacheRead),
		cacheWriteTokens: delta((s) => s.cacheWrite),
		cost: delta((s) => s.cost),
	};
}

/** Traduz eventos tool_execution_start/end da sessao em ToolStep. */
export function watchTools(session: AgentSession, onStep: (step: ToolStep) => void, now: () => number): () => void {
	const subscribe = (session as unknown as { subscribe?: (cb: (e: unknown) => void) => () => void }).subscribe;
	if (typeof subscribe !== "function") return () => undefined;
	const started = new Map<string, { tool: string; args: string; at: number }>();
	return subscribe.call(session, (event: unknown) => {
		const e = event as Record<string, unknown>;
		const id = e["toolCallId"];
		if (typeof id !== "string") return;
		if (e["type"] === "tool_execution_start") {
			started.set(id, {
				tool: String(e["toolName"] ?? "tool"),
				args: JSON.stringify(e["args"] ?? {}).slice(0, 2000),
				at: now(),
			});
		} else if (e["type"] === "tool_execution_end") {
			const s = started.get(id);
			started.delete(id);
			const result = e["result"] as { content?: { type: string; text?: string }[] } | undefined;
			const output = (result?.content ?? [])
				.filter((b) => b.type === "text" && b.text)
				.map((b) => String(b.text))
				.join("\n")
				.slice(0, 4000);
			try {
				onStep({
					tool: String(e["toolName"] ?? s?.tool ?? "tool"),
					args: s?.args ?? "{}",
					output,
					durationMs: s ? now() - s.at : 0,
				});
			} catch {
				/* quem ouve nunca quebra a resposta */
			}
		}
	});
}

export interface PiChatAgentOptions {
	pool: SessionPool;
	metrics: MetricsSink;
	/** Modelo pedido no config (fallback da metrica). */
	model: () => string;
	now?: () => number;
}

export class PiChatAgent implements ChatAgent, ChatSessions {
	private readonly opts: PiChatAgentOptions;
	private readonly now: () => number;

	constructor(opts: PiChatAgentOptions) {
		this.opts = opts;
		this.now = opts.now ?? Date.now;
	}

	async ask(request: ChatRequest): Promise<string> {
		const session = await this.opts.pool.get(request.channelId, request.role, request.systemPrompt || undefined);
		const stop = request.onToolStep ? watchTools(session, request.onToolStep, this.now) : () => undefined;
		const before = statsOf(session);
		const started = this.now();
		const report = (status: TurnReport["status"]) =>
			this.opts.metrics.record(
				turnReport(
					session,
					before,
					{ operation: "chat", source: request.source ?? "discord", status, latencyMs: this.now() - started },
					this.opts.model(),
				),
			);
		try {
			const images = request.images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType }));
			const text = await this.opts.pool.ask(session, request.text, images);
			report("success");
			return text;
		} catch (err) {
			report("error");
			throw err;
		} finally {
			try {
				stop();
			} catch {
				/* ignora */
			}
		}
	}

	conversations(): string[] {
		return this.opts.pool.conversations();
	}

	forget(conversationId: string): void {
		this.opts.pool.forget(conversationId);
	}
}
