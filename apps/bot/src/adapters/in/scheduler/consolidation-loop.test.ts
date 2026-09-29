import { describe, expect, it } from "bun:test";
import type { ConsolidateMemory } from "../../../application/consolidate-memory.ts";
import { startConsolidationLoop } from "./consolidation-loop.ts";

function fakeConsolidate(onCall: (channels: readonly string[]) => Promise<void>): ConsolidateMemory {
	return {
		all: async (channels: readonly string[]) => {
			await onCall(channels);
			return { channels: 0, memories: 0 };
		},
	} as unknown as ConsolidateMemory;
}

describe("startConsolidationLoop", () => {
	it("roda a cada intervalo com os canais do momento, ate parar", async () => {
		const seen: string[][] = [];
		let channels = ["c1"];
		const stop = startConsolidationLoop(
			fakeConsolidate(async (c) => void seen.push([...c])),
			{ channels: () => channels, intervalMs: 5 },
		);
		await new Promise((r) => setTimeout(r, 12));
		channels = ["c1", "c2"];
		await new Promise((r) => setTimeout(r, 12));
		stop();
		const count = seen.length;
		await new Promise((r) => setTimeout(r, 15));
		expect(seen.length).toBe(count);
		expect(seen[0]).toEqual(["c1"]);
		expect(seen.at(-1)).toEqual(["c1", "c2"]);
	});

	it("erro num tick nao mata o laco", async () => {
		let calls = 0;
		const stop = startConsolidationLoop(
			fakeConsolidate(async () => {
				calls += 1;
				throw new Error("x");
			}),
			{ channels: () => [], intervalMs: 5 },
		);
		await new Promise((r) => setTimeout(r, 25));
		stop();
		expect(calls).toBeGreaterThan(1);
	});
});
