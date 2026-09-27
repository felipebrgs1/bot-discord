import { describe } from "bun:test";
import { metricsContract } from "../../application/ports/metrics.contract.ts";
import { FakeMetrics } from "./metrics.ts";

describe("FakeMetrics", () => {
	metricsContract(() => new FakeMetrics());
});
