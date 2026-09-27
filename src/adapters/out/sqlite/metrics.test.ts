import { describe, expect, it } from "bun:test";
import { metricsContract } from "../../../application/ports/metrics.contract.ts";
import { openDatabase } from "./db.ts";
import { SqliteMetrics } from "./metrics.ts";

describe("SqliteMetrics", () => {
	metricsContract(() => new SqliteMetrics(openDatabase(":memory:")));

	it("falha do banco no record nao propaga", () => {
		const db = openDatabase(":memory:");
		db.exec("DROP TABLE ai_requests;");
		expect(() =>
			new SqliteMetrics(db).record({
				operation: "chat",
				model: "",
				provider: "",
				source: "discord",
				status: "success",
				latencyMs: 1,
				inputTokens: null,
				outputTokens: null,
				cachedTokens: null,
				cacheWriteTokens: null,
				cost: null,
			}),
		).not.toThrow();
	});
});
