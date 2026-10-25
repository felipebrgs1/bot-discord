/** Roda um tick a cada intervalo, um por vez (cutucao, apuracao). */

export function startTickLoop(job: { tick(): Promise<void> }, intervalMs: number): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (stopped) return;
		timer = setTimeout(() => void tick(), intervalMs);
		timer.unref?.();
	};
	const tick = async (): Promise<void> => {
		try {
			await job.tick();
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
