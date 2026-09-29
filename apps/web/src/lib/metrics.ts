import type { MetricTotals, RecentCall } from "@elmatadore/api";

/** Percentual de falhas; null sem requisicoes. */
export const failureRate = (t: MetricTotals): number | null =>
	t.requests > 0 ? (t.failures / t.requests) * 100 : null;

/** Percentual da entrada servida do cache; null sem tokens de entrada. */
export const cacheShare = (t: MetricTotals): number | null =>
	t.input_tokens > 0 ? (t.cached_tokens / t.input_tokens) * 100 : null;

export function tokensPerSecond(c: RecentCall): number | null {
	if (!c.success || c.output_tokens === null || c.duration_ms <= 0) return null;
	return c.output_tokens / (c.duration_ms / 1000);
}

export interface CallPoint {
	id: number;
	at: string;
	latencyMs: number;
	success: boolean;
}

/** `recent` vem do mais novo ao mais velho; o grafico quer o tempo andando. */
export const callSeries = (recent: readonly RecentCall[]): CallPoint[] =>
	[...recent]
		.sort((a, b) => a.started_at.localeCompare(b.started_at))
		.map((c) => ({ id: c.id, at: c.started_at, latencyMs: c.duration_ms, success: c.success }));
