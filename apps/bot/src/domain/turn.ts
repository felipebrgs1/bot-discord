/** Um turno do agente (uma pergunta respondida), para telemetria. */
export interface TurnReport {
	operation: string;
	model: string;
	provider: string;
	/** De onde veio: "discord" | "web". */
	source: string;
	status: "success" | "error";
	latencyMs: number;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens: number | null;
	cacheWriteTokens: number | null;
	cost: number | null;
}
