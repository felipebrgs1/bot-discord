/** Quanto falta (ms) para o canal poder receber outra resposta. */
export function cooldownRemaining(now: number, lastReplyAt: number | undefined, cooldownMs: number): number {
	if (lastReplyAt === undefined) return 0;
	return Math.max(0, cooldownMs - (now - lastReplyAt));
}
