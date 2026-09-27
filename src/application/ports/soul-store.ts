import type { Soul } from "../../domain/soul.ts";

export interface SoulStore {
	/** Garante a soul padrao (idempotente). */
	ensureSeed(fallbackBody: string): void;
	list(): Soul[];
	get(name: string): Soul | undefined;
	/** Cria ou substitui; o nome e normalizado (soulSlug). */
	save(name: string, body: string): void;
	/** Soul do canal; sem escolha, a padrao. */
	channelSoul(channelId: string): string;
	/** Lanca se a soul nao existe. */
	setChannel(channelId: string, soulName: string): void;
	/** Corpo da soul vigente no canal ('' se sumiu). */
	bodyFor(channelId: string): string;
}
