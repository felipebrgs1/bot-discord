import { expect, it } from "bun:test";
import type { Clock } from "./clock.ts";

export function clockContract(make: () => Clock): void {
	it("now nunca volta no tempo", () => {
		const clock = make();
		const a = clock.now();
		const b = clock.now();
		expect(b).toBeGreaterThanOrEqual(a);
	});

	it("sleep(ms) avanca now() em pelo menos ms", async () => {
		const clock = make();
		const before = clock.now();
		await clock.sleep(20);
		// 1 ms de folga: timers do runtime arredondam para baixo.
		expect(clock.now() - before).toBeGreaterThanOrEqual(19);
	});

	it("sleep(0) resolve", async () => {
		await make().sleep(0);
	});
}
