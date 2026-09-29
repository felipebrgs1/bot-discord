import type { Clock } from "../../../application/ports/clock.ts";

export const systemClock: Clock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
