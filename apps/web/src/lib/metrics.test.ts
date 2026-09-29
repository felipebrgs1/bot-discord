import { describe, expect, it } from "bun:test";
import type { MetricTotals, RecentCall } from "@elmatadore/api";
import { cacheShare, callSeries, failureRate, tokensPerSecond } from "./metrics.ts";

const totals = (patch: Partial<MetricTotals>): MetricTotals => ({
	requests: 0,
	failures: 0,
	input_tokens: 0,
	output_tokens: 0,
	cached_tokens: 0,
	cache_write_tokens: 0,
	cache_samples: 0,
	cost_usd: 0,
	...patch,
});

const call = (id: number, patch: Partial<RecentCall> = {}): RecentCall => ({
	id,
	started_at: `2026-09-29T12:00:0${id}.000Z`,
	duration_ms: 1000,
	operation: "chat",
	source: "discord",
	provider: "p",
	model: "m",
	success: true,
	input_tokens: 10,
	output_tokens: 20,
	total_tokens: 30,
	cached_tokens: 0,
	cache_write_tokens: 0,
	cost_usd: 0,
	...patch,
});

describe("failureRate", () => {
	it("falhas sobre requisicoes; sem requisicao e null", () => {
		expect(failureRate(totals({ requests: 8, failures: 2 }))).toBe(25);
		expect(failureRate(totals({}))).toBeNull();
	});
});

describe("cacheShare", () => {
	it("tokens lidos do cache sobre a entrada total", () => {
		expect(cacheShare(totals({ input_tokens: 300, cached_tokens: 100 }))).toBeCloseTo(33.33, 1);
		expect(cacheShare(totals({}))).toBeNull();
	});
});

describe("tokensPerSecond", () => {
	it("saida por segundo so em chamada bem-sucedida com duracao", () => {
		expect(tokensPerSecond(call(1, { output_tokens: 50, duration_ms: 2000 }))).toBe(25);
		expect(tokensPerSecond(call(1, { success: false }))).toBeNull();
		expect(tokensPerSecond(call(1, { duration_ms: 0 }))).toBeNull();
		expect(tokensPerSecond(call(1, { output_tokens: null }))).toBeNull();
	});
});

describe("callSeries", () => {
	it("ordena do mais antigo ao mais novo (recent vem ao contrario)", () => {
		const out = callSeries([call(3, { duration_ms: 300 }), call(1, { duration_ms: 100, success: false })]);
		expect(out).toEqual([
			{ id: 1, at: "2026-09-29T12:00:01.000Z", latencyMs: 100, success: false },
			{ id: 3, at: "2026-09-29T12:00:03.000Z", latencyMs: 300, success: true },
		]);
	});
});
