import type { ConfigStore } from "../../application/ports/config-store.ts";
import { type BotSettings, getSetting, settingsFrom } from "../../domain/settings.ts";

export class FakeConfigStore implements ConfigStore {
	private readonly entries = new Map<string, unknown>();

	constructor(initial: Record<string, unknown> = {}) {
		for (const [key, value] of Object.entries(initial)) this.entries.set(key, value);
	}

	all(): BotSettings {
		return settingsFrom([...this.entries].map(([key, value]) => ({ key, value })));
	}

	get(key: string): unknown {
		return getSetting(this.all(), key);
	}

	set(key: string, value: unknown): void {
		this.entries.delete(key);
		this.entries.set(key, structuredClone(value));
	}
}
