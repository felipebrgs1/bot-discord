import type { Clock } from "../../application/ports/clock.ts";

export class FakeClock implements Clock {
	readonly sleeps: number[] = [];
	private time: number;

	constructor(start = 0) {
		this.time = start;
	}

	now(): number {
		return this.time;
	}

	/** Nao espera: registra e avanca o tempo na hora. */
	async sleep(ms: number): Promise<void> {
		this.sleeps.push(ms);
		this.time += ms;
	}

	advance(ms: number): void {
		this.time += ms;
	}
}
