import type { DatabaseSync } from "node:sqlite";
import type {
	MetricsQuery,
	MetricsSink,
	MetricsSnapshot,
	MetricsTotals,
	ModelMetrics,
	RecentTurn,
} from "../../../application/ports/metrics.ts";
import type { TurnReport } from "../../../domain/turn.ts";

const TOTALS = `COUNT(*) AS requests,
  COALESCE(SUM(status <> 'success'),0) AS failures,
  COALESCE(SUM(input_tokens),0) AS inputTokens,
  COALESCE(SUM(output_tokens),0) AS outputTokens,
  COALESCE(SUM(cached_tokens),0) AS cachedTokens,
  COALESCE(SUM(cache_write_tokens),0) AS cacheWriteTokens,
  COUNT(CASE WHEN COALESCE(cached_tokens,0) > 0 OR COALESCE(cache_write_tokens,0) > 0 THEN 1 END) AS cacheSamples,
  COALESCE(SUM(cost),0) AS costUsd`;

interface RecentRow {
	rowid: number;
	created_at: string;
	latency_ms: number;
	operation: string;
	source: string;
	provider: string;
	model: string;
	status: string;
	input_tokens: number | null;
	output_tokens: number | null;
	cached_tokens: number | null;
	cache_write_tokens: number | null;
	cost: number | null;
}

/** Tabela `ai_requests`: um registro por turno do agente. */
export class SqliteMetrics implements MetricsSink, MetricsQuery {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	record(t: TurnReport): void {
		try {
			this.db
				.prepare(
					`INSERT INTO ai_requests
           (operation, model, provider, source, status, latency_ms,
            input_tokens, output_tokens, cached_tokens, cache_write_tokens, cost)
           VALUES (?,?,?,?,?,?,?,?,?,?,?);`,
				)
				.run(
					t.operation,
					t.model,
					t.provider,
					t.source,
					t.status,
					Math.round(t.latencyMs),
					t.inputTokens,
					t.outputTokens,
					t.cachedTokens,
					t.cacheWriteTokens,
					t.cost,
				);
		} catch {
			/* telemetria nunca quebra resposta */
		}
	}

	snapshot(): MetricsSnapshot {
		const totals = { ...(this.db.prepare(`SELECT ${TOTALS} FROM ai_requests;`).get() as unknown as MetricsTotals) };
		const byModel = (
			this.db
				.prepare(
					`SELECT model, provider, operation, source, ${TOTALS}, AVG(latency_ms) AS avgLatencyMs
           FROM ai_requests GROUP BY model, provider, operation, source;`,
				)
				.all() as unknown as ModelMetrics[]
		).map((m) => ({ ...m }));
		const recent = (
			this.db.prepare("SELECT * FROM ai_requests ORDER BY rowid DESC LIMIT 50;").all() as unknown as RecentRow[]
		).map(
			(r): RecentTurn => ({
				id: r.rowid,
				startedAt: r.created_at,
				durationMs: r.latency_ms,
				operation: r.operation,
				source: r.source,
				provider: r.provider,
				model: r.model,
				success: r.status === "success",
				inputTokens: r.input_tokens,
				outputTokens: r.output_tokens,
				cachedTokens: r.cached_tokens,
				cacheWriteTokens: r.cache_write_tokens,
				costUsd: r.cost,
			}),
		);
		return { totals, byModel, recent };
	}
}
