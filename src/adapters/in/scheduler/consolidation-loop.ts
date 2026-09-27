/** Dispara a consolidacao de memoria a cada intervalo (um tick por vez). */

import type { ConsolidateMemory, ConsolidateOptions } from "../../../application/consolidate-memory.ts";

export interface LoopOptions extends ConsolidateOptions {
	channels: () => readonly string[];
	intervalMs: number;
}

export function startConsolidationLoop(consolidate: ConsolidateMemory, opts: LoopOptions): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => void tick(), opts.intervalMs);
		timer.unref?.();
	};
	const tick = async (): Promise<void> => {
		try {
			await consolidate.all(opts.channels(), opts);
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
