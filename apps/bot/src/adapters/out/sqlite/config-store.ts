/**
 * ConfigStore sobre a tabela `config` (JSON por valor). Padroes e regra de
 * mescla no dominio (settingsFrom); aqui so leitura/escrita + cache curto.
 * Hot reload: all() rele depois de ttlMs; subscribe() avisa mudancas.
 */

import type { DatabaseSync } from "node:sqlite";
import type { ConfigStore } from "../../../application/ports/config-store.ts";
import { type BotSettings, getSetting, type SettingEntry, settingsFrom } from "../../../domain/settings.ts";

export class SqliteConfigStore implements ConfigStore {
	private readonly db: DatabaseSync;
	private cache: BotSettings;
	private cacheAt = 0;
	private readonly ttlMs: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private readonly listeners = new Set<(key: string) => void>();
	private readonly lastSeen = new Map<string, string>();

	constructor(db: DatabaseSync, ttlMs = 2000) {
		this.db = db;
		this.ttlMs = ttlMs;
		this.cache = this.load();
	}

	all(): BotSettings {
		if (Date.now() - this.cacheAt > this.ttlMs) this.cache = this.load();
		return this.cache;
	}

	get(key: string): unknown {
		return getSetting(this.all(), key);
	}

	set(key: string, value: unknown): void {
		this.db
			.prepare(
				`INSERT INTO config (key, value, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(key) DO UPDATE
         SET value = excluded.value, updated_at = excluded.updated_at;`,
			)
			.run(key, JSON.stringify(value));
		this.cache = this.load();
		this.emit(key);
	}

	/** Ultima escrita da chave ('' se nunca gravada). */
	updatedAt(key: string): string {
		const row = this.db.prepare("SELECT updated_at AS u FROM config WHERE key = ?;").get(key) as
			| { u: string }
			| undefined;
		return row?.u ?? "";
	}

	/** Avisa mudancas (inclusive de outro processo, por polling a cada ttlMs). */
	subscribe(listener: (key: string) => void): () => void {
		this.listeners.add(listener);
		if (!this.timer) {
			this.timer = setInterval(() => this.poll(), this.ttlMs);
			this.timer.unref?.();
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0 && this.timer) {
				clearInterval(this.timer);
				this.timer = undefined;
			}
		};
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.listeners.clear();
	}

	private emit(key: string): void {
		for (const listener of this.listeners) {
			try {
				listener(key);
			} catch {
				/* listener nunca quebra escrita de config */
			}
		}
	}

	private stamps(): { key: string; updated_at: string }[] {
		return this.db.prepare("SELECT key, updated_at FROM config;").all() as { key: string; updated_at: string }[];
	}

	private poll(): void {
		let rows: { key: string; updated_at: string }[];
		try {
			rows = this.stamps();
		} catch {
			return;
		}
		const seen = new Set<string>();
		for (const r of rows) {
			seen.add(r.key);
			if (this.lastSeen.get(r.key) !== r.updated_at) {
				this.lastSeen.set(r.key, r.updated_at);
				this.cache = this.load();
				this.emit(r.key);
			}
		}
		for (const k of [...this.lastSeen.keys()]) {
			if (!seen.has(k)) this.lastSeen.delete(k);
		}
	}

	private load(): BotSettings {
		this.cacheAt = Date.now();
		const entries: SettingEntry[] = [];
		try {
			const rows = this.db.prepare("SELECT key, value FROM config;").all() as { key: string; value: string }[];
			for (const r of rows) {
				try {
					entries.push({ key: r.key, value: JSON.parse(r.value) });
				} catch {
					/* valor corrompido: fica o padrao */
				}
			}
			for (const s of this.stamps()) this.lastSeen.set(s.key, s.updated_at);
		} catch {
			/* tabela ainda nao existe */
		}
		return settingsFrom(entries);
	}
}
