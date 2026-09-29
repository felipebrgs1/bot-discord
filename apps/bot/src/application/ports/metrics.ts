import type { TurnReport } from "../../domain/turn.ts";

export interface MetricsSink {
	/** Nunca lanca: telemetria nao quebra resposta. */
	record(turn: TurnReport): void;
}

export interface MetricsTotals {
	requests: number;
	failures: number;
	inputTokens: number;
	outputTokens: number;
	cachedTokens: number;
	cacheWriteTokens: number;
	/** Turnos com algum token de cache (leitura ou escrita). */
	cacheSamples: number;
	costUsd: number;
}

export interface ModelMetrics extends MetricsTotals {
	model: string;
	provider: string;
	operation: string;
	source: string;
	avgLatencyMs: number | null;
}

export interface RecentTurn {
	id: number;
	startedAt: string;
	durationMs: number;
	operation: string;
	source: string;
	provider: string;
	model: string;
	success: boolean;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens: number | null;
	cacheWriteTokens: number | null;
	costUsd: number | null;
}

export interface MetricsSnapshot {
	totals: MetricsTotals;
	byModel: ModelMetrics[];
	/** Ate 50, mais novos primeiro. */
	recent: RecentTurn[];
}

export interface MetricsQuery {
	snapshot(): MetricsSnapshot;
}
