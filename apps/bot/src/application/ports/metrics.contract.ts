import { expect, it } from "bun:test";
import type { TurnReport } from "../../domain/turn.ts";
import type { MetricsQuery, MetricsSink } from "./metrics.ts";

const turn = (over: Partial<TurnReport> = {}): TurnReport => ({
	operation: "chat",
	model: "m1",
	provider: "p",
	source: "discord",
	status: "success",
	latencyMs: 100,
	inputTokens: 10,
	outputTokens: 5,
	cachedTokens: 0,
	cacheWriteTokens: 0,
	cost: 0.01,
	...over,
});

export function metricsContract(make: () => MetricsSink & MetricsQuery): void {
	it("vazio e tudo zero", () => {
		const { totals, byModel, recent } = make().snapshot();
		expect(totals).toEqual({
			requests: 0,
			failures: 0,
			inputTokens: 0,
			outputTokens: 0,
			cachedTokens: 0,
			cacheWriteTokens: 0,
			cacheSamples: 0,
			costUsd: 0,
		});
		expect(byModel).toEqual([]);
		expect(recent).toEqual([]);
	});

	it("soma turnos, conta falhas e amostras de cache", () => {
		const metrics = make();
		metrics.record(turn());
		metrics.record(turn({ status: "error", inputTokens: null, outputTokens: null, cost: null }));
		metrics.record(turn({ model: "m2", cachedTokens: 7, cacheWriteTokens: 3 }));
		const { totals } = metrics.snapshot();
		expect(totals).toMatchObject({
			requests: 3,
			failures: 1,
			inputTokens: 20,
			outputTokens: 10,
			cachedTokens: 7,
			cacheWriteTokens: 3,
			cacheSamples: 1,
		});
		expect(totals.costUsd).toBeCloseTo(0.02);
	});

	it("agrupa por modelo com latencia media", () => {
		const metrics = make();
		metrics.record(turn({ latencyMs: 100 }));
		metrics.record(turn({ latencyMs: 300 }));
		metrics.record(turn({ model: "m2" }));
		const m1 = metrics.snapshot().byModel.find((m) => m.model === "m1");
		expect(m1).toMatchObject({ requests: 2, provider: "p", operation: "chat", source: "discord", avgLatencyMs: 200 });
		expect(metrics.snapshot().byModel).toHaveLength(2);
	});

	it("recentes: mais novo primeiro, com sucesso e tokens nulos preservados", () => {
		const metrics = make();
		metrics.record(turn({ model: "velho" }));
		metrics.record(turn({ model: "novo", status: "error", inputTokens: null, latencyMs: 12.6 }));
		const [first, second] = metrics.snapshot().recent;
		expect(first).toMatchObject({ model: "novo", success: false, inputTokens: null, durationMs: 13 });
		expect(second).toMatchObject({ model: "velho", success: true });
		expect((first?.id ?? 0) > (second?.id ?? 0)).toBe(true);
	});
}
