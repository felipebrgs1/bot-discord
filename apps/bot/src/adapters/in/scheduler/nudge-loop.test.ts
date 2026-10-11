import { describe, expect, it } from "bun:test";
import { startNudgeLoop } from "./nudge-loop.ts";

describe("startNudgeLoop", () => {
	it("verifica a cada intervalo, ate parar", async () => {
		let calls = 0;
		const stop = startNudgeLoop({ tick: async () => void (calls += 1) }, 5);
		await new Promise((r) => setTimeout(r, 22));
		stop();
		const count = calls;
		await new Promise((r) => setTimeout(r, 15));
		expect(count).toBeGreaterThan(1);
		expect(calls).toBe(count);
	});

	it("erro num tick nao mata o laco", async () => {
		let calls = 0;
		const stop = startNudgeLoop(
			{
				tick: async () => {
					calls += 1;
					throw new Error("x");
				},
			},
			5,
		);
		await new Promise((r) => setTimeout(r, 25));
		stop();
		expect(calls).toBeGreaterThan(1);
	});
});
