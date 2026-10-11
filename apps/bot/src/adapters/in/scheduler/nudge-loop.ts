/** Verifica canais parados a cada intervalo (um tick por vez). */

import type { IdleNudge } from "@/application/idle-nudge.ts";

export function startNudgeLoop(nudge: Pick<IdleNudge, "tick">, intervalMs: number): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => void tick(), intervalMs);
		timer.unref?.();
	};
	const tick = async (): Promise<void> => {
		try {
			await nudge.tick();
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
