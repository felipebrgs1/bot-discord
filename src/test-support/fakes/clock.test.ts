import { describe, expect, it } from "bun:test";
import { clockContract } from "../../application/ports/clock.contract.ts";
import { FakeClock } from "./clock.ts";

describe("FakeClock", () => {
	clockContract(() => new FakeClock(1_000));

	it("registra cada sleep e avanca o tempo sem esperar", async () => {
		const clock = new FakeClock(0);
		await clock.sleep(3_000);
		await clock.sleep(500);
		expect(clock.sleeps).toEqual([3_000, 500]);
		expect(clock.now()).toBe(3_500);
	});

	it("advance move o tempo sem registrar sleep", () => {
		const clock = new FakeClock(0);
		clock.advance(42);
		expect(clock.now()).toBe(42);
		expect(clock.sleeps).toEqual([]);
	});
});
