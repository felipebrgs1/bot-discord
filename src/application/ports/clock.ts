/** Tempo (epoch ms) e espera. Porta para testar cooldown e TTL sem relogio real. */
export interface Clock {
	now(): number;
	sleep(ms: number): Promise<void>;
}
