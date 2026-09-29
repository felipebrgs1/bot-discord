import type { SoulStore } from "../../application/ports/soul-store.ts";
import { DEFAULT_SOUL, type Soul, soulSlug } from "../../domain/soul.ts";

export class FakeSoulStore implements SoulStore {
	private readonly souls = new Map<string, string>();
	private readonly channels = new Map<string, string>();

	ensureSeed(fallbackBody: string): void {
		if (!this.souls.has(DEFAULT_SOUL)) this.souls.set(DEFAULT_SOUL, fallbackBody);
	}

	list(): Soul[] {
		return [...this.souls]
			.map(([name, body]) => ({ name, body }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	get(name: string): Soul | undefined {
		const body = this.souls.get(name);
		return body === undefined ? undefined : { name, body };
	}

	save(name: string, body: string): void {
		this.souls.set(soulSlug(name), body);
	}

	channelSoul(channelId: string): string {
		return this.channels.get(channelId) ?? DEFAULT_SOUL;
	}

	setChannel(channelId: string, soulName: string): void {
		if (!this.souls.has(soulName)) throw new Error(`soul desconhecida: ${soulName}`);
		this.channels.set(channelId, soulName);
	}

	bodyFor(channelId: string): string {
		return this.get(this.channelSoul(channelId))?.body ?? "";
	}
}
