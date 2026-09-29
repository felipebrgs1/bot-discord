import type { BotSettings } from "../../domain/settings.ts";

/** Config da aplicacao (segredos ficam fora: so no ambiente, lidos pelo main). */
export interface ConfigStore {
	all(): BotSettings;
	/** Chave pontuada, ex.: "chat.model". */
	get(key: string): unknown;
	/** Chave de secao ("discord") ou pontuada ("chat.model"). */
	set(key: string, value: unknown): void;
}
