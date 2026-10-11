import type { DatabaseSync } from "node:sqlite";
import type { LearningEvent, MemoryAdmin, MemoryBlockRecord, MemoryBlockVersion } from "@/application/ports/memory-admin.ts";
import type { MemoryStore } from "@/application/ports/memory-store.ts";
import type { MemoryBlockRef, MemoryScope } from "@/domain/memory.ts";

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** JSON gravado por nos; qualquer coisa fora do formato vira bloco vazio. */
function parseEntries(text: string): string[] {
	try {
		const v: unknown = JSON.parse(text);
		return Array.isArray(v) ? v.filter((e): e is string => typeof e === "string") : [];
	} catch {
		return [];
	}
}

const scopeOf = (s: string): MemoryScope => (s === "user" ? "user" : "group");

/** Tabelas `memory_blocks`, `memory_block_versions` e `memory_cursors`. */
export class SqliteMemoryStore implements MemoryStore, MemoryAdmin {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	read(ref: MemoryBlockRef): string[] {
		const row = this.db
			.prepare("SELECT entries FROM memory_blocks WHERE scope = ? AND owner_id = ?;")
			.get(ref.scope, ref.ownerId) as { entries: string } | undefined;
		return row ? parseEntries(row.entries) : [];
	}

	write(ref: MemoryBlockRef, entries: readonly string[], reason: string): void {
		const json = JSON.stringify(entries);
		this.db.exec("BEGIN;");
		try {
			this.db
				.prepare(
					`INSERT INTO memory_blocks (scope, owner_id, entries, updated_at) VALUES (?,?,?,${NOW})
           ON CONFLICT(scope, owner_id) DO UPDATE SET entries = excluded.entries, updated_at = excluded.updated_at;`,
				)
				.run(ref.scope, ref.ownerId, json);
			this.db
				.prepare("INSERT INTO memory_block_versions (scope, owner_id, entries, reason) VALUES (?,?,?,?);")
				.run(ref.scope, ref.ownerId, json, reason);
			this.db.exec("COMMIT;");
		} catch (err) {
			try {
				this.db.exec("ROLLBACK;");
			} catch {
				/* ja desfeita */
			}
			throw err;
		}
	}

	cursor(channelId: string): number {
		const row = this.db.prepare("SELECT last_rowid FROM memory_cursors WHERE channel_id = ?;").get(channelId) as
			| { last_rowid: number }
			| undefined;
		return row?.last_rowid ?? 0;
	}

	setCursor(channelId: string, seq: number): void {
		this.db
			.prepare(
				"INSERT INTO memory_cursors (channel_id, last_rowid) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET last_rowid = excluded.last_rowid;",
			)
			.run(channelId, seq);
	}

	blocks(): MemoryBlockRecord[] {
		const rows = this.db
			.prepare(
				`SELECT b.scope, b.owner_id, b.entries, b.updated_at,
           (SELECT m.author_name FROM messages m WHERE b.scope = 'user' AND m.author_id = b.owner_id
            ORDER BY m.rowid DESC LIMIT 1) AS author_name
         FROM memory_blocks b
         ORDER BY CASE b.scope WHEN 'group' THEN 0 ELSE 1 END, b.updated_at DESC, b.rowid DESC;`,
			)
			.all() as { scope: string; owner_id: string; entries: string; updated_at: string; author_name: string | null }[];
		return rows.map((r) => ({
			scope: scopeOf(r.scope),
			ownerId: r.owner_id,
			name: r.author_name || r.owner_id,
			entries: parseEntries(r.entries),
			updatedAt: r.updated_at,
		}));
	}

	versions(scope: MemoryScope, ownerId: string): MemoryBlockVersion[] {
		const rows = this.db
			.prepare(
				"SELECT rowid, entries, reason, created_at FROM memory_block_versions WHERE scope = ? AND owner_id = ? ORDER BY rowid;",
			)
			.all(scope, ownerId) as { rowid: number; entries: string; reason: string; created_at: string }[];
		return rows.map((v) => ({ id: v.rowid, entries: parseEntries(v.entries), reason: v.reason, createdAt: v.created_at }));
	}

	timeline(limit: number): LearningEvent[] {
		const versions = this.db
			.prepare("SELECT rowid, created_at AS at, scope, owner_id, reason FROM memory_block_versions ORDER BY rowid DESC LIMIT ?;")
			.all(limit) as { rowid: number; at: string; scope: string; owner_id: string; reason: string }[];
		const skills = this.db
			.prepare("SELECT created_at AS at, skill_name, usage, result, channel_id FROM skill_runs ORDER BY rowid DESC LIMIT ?;")
			.all(limit) as { at: string; skill_name: string; usage: string; result: string; channel_id: string }[];
		const events: LearningEvent[] = [
			...versions.map((v) => ({
				at: v.at,
				kind: "memory" as const,
				channelId: v.scope === "group" ? v.owner_id : "",
				subject: `${v.scope}:${v.owner_id}`,
				detail: v.reason || "versão registrada",
			})),
			...skills.map((s) => ({
				at: s.at,
				kind: "skill" as const,
				channelId: s.channel_id,
				subject: s.skill_name,
				detail: `${s.usage} (${s.result})`,
			})),
		];
		// Ordenacao estavel: versoes ja vem da mais nova; empate de horario mantem essa ordem.
		return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
	}
}
