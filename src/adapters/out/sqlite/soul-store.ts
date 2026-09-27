import type { DatabaseSync } from "node:sqlite";
import type { SoulStore } from "../../../application/ports/soul-store.ts";
import { DEFAULT_SOUL, type Soul, soulSlug } from "../../../domain/soul.ts";

/** Tabelas `souls` e `channel_soul` (migracao v2). */
export class SqliteSoulStore implements SoulStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	ensureSeed(fallbackBody: string): void {
		this.db.prepare("INSERT OR IGNORE INTO souls (name, body) VALUES (?, ?);").run(DEFAULT_SOUL, fallbackBody);
	}

	list(): Soul[] {
		return this.db.prepare("SELECT name, body FROM souls ORDER BY name;").all() as unknown as Soul[];
	}

	get(name: string): Soul | undefined {
		return this.db.prepare("SELECT name, body FROM souls WHERE name = ?;").get(name) as unknown as Soul | undefined;
	}

	save(name: string, body: string): void {
		this.db
			.prepare(
				`INSERT INTO souls (name, body, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
         ON CONFLICT(name) DO UPDATE
         SET body = excluded.body, updated_at = excluded.updated_at;`,
			)
			.run(soulSlug(name), body);
	}

	channelSoul(channelId: string): string {
		const row = this.db.prepare("SELECT soul_name FROM channel_soul WHERE channel_id = ?;").get(channelId) as
			| { soul_name: string }
			| undefined;
		return row?.soul_name ?? DEFAULT_SOUL;
	}

	setChannel(channelId: string, soulName: string): void {
		if (!this.get(soulName)) throw new Error(`soul desconhecida: ${soulName}`);
		this.db
			.prepare(
				"INSERT INTO channel_soul (channel_id, soul_name) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET soul_name = excluded.soul_name;",
			)
			.run(channelId, soulName);
	}

	bodyFor(channelId: string): string {
		return this.get(this.channelSoul(channelId))?.body ?? "";
	}
}
