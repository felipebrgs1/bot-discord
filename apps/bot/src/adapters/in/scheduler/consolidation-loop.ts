/** Dispara a revisao de memoria a cada intervalo (um tick por vez). */

import type { ReviewMemory, ReviewOptions } from "../../../application/review-memory.ts";

export interface LoopOptions extends ReviewOptions {
	channels: () => readonly string[];
	intervalMs: number;
}

export function startConsolidationLoop(review: ReviewMemory, opts: LoopOptions): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => void tick(), opts.intervalMs);
		timer.unref?.();
	};
	const tick = async (): Promise<void> => {
		try {
			await review.all(opts.channels(), opts);
		} catch {
			/* proximo tick tenta de novo */
		} finally {
			schedule();
		}
	};
	schedule();
	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}
