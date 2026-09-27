import type { MetricsQuery, MetricsSink, MetricsSnapshot, MetricsTotals } from "../../application/ports/metrics.ts";
import type { TurnReport } from "../../domain/turn.ts";

function totalsOf(turns: readonly TurnReport[]): MetricsTotals {
	const sum = (f: (t: TurnReport) => number | null) => turns.reduce((acc, t) => acc + (f(t) ?? 0), 0);
	return {
		requests: turns.length,
		failures: turns.filter((t) => t.status !== "success").length,
		inputTokens: sum((t) => t.inputTokens),
		outputTokens: sum((t) => t.outputTokens),
		cachedTokens: sum((t) => t.cachedTokens),
		cacheWriteTokens: sum((t) => t.cacheWriteTokens),
		cacheSamples: turns.filter((t) => (t.cachedTokens ?? 0) > 0 || (t.cacheWriteTokens ?? 0) > 0).length,
		costUsd: sum((t) => t.cost),
	};
}

export class FakeMetrics implements MetricsSink, MetricsQuery {
	readonly turns: TurnReport[] = [];

	record(turn: TurnReport): void {
		this.turns.push({ ...turn, latencyMs: Math.round(turn.latencyMs) });
	}

	snapshot(): MetricsSnapshot {
		const groups = new Map<string, TurnReport[]>();
		for (const t of this.turns) {
			const key = [t.model, t.provider, t.operation, t.source].join("|");
			groups.set(key, [...(groups.get(key) ?? []), t]);
		}
		return {
			totals: totalsOf(this.turns),
			byModel: [...groups.values()].map((g) => {
				const first = g[0] as TurnReport;
				return {
					...totalsOf(g),
					model: first.model,
					provider: first.provider,
					operation: first.operation,
					source: first.source,
					avgLatencyMs: g.reduce((a, t) => a + t.latencyMs, 0) / g.length,
				};
			}),
			recent: this.turns
				.map((t, i) => ({
					id: i + 1,
					startedAt: new Date((i + 1) * 1000).toISOString(),
					durationMs: t.latencyMs,
					operation: t.operation,
					source: t.source,
					provider: t.provider,
					model: t.model,
					success: t.status === "success",
					inputTokens: t.inputTokens,
					outputTokens: t.outputTokens,
					cachedTokens: t.cachedTokens,
					cacheWriteTokens: t.cacheWriteTokens,
					costUsd: t.cost,
				}))
				.reverse()
				.slice(0, 50),
		};
	}
}
