import type { DatabaseSync } from "node:sqlite";
import type { LearningEvent, MemoryAdmin, MemoryRecord, MemoryVersion } from "../../../application/ports/memory-admin.ts";
import type { MemoryStore } from "../../../application/ports/memory-store.ts";
import type { Extraction, FamiliarMemory, MemoryHit, MemoryStatus } from "../../../domain/memory.ts";

interface Row {
	rowid: number;
	key: string;
	kind: string;
	scope: string;
	person_id: string;
	channel_id: string;
	content: string;
	status: string;
	updated_at: string;
}

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Tabelas `memories` (+FTS5), `memory_versions`, `episodes`, `memory_cursors`. */
export class SqliteMemoryStore implements MemoryStore, MemoryAdmin {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	cursor(channelId: string): number {
		const row = this.db.prepare("SELECT last_rowid FROM memory_cursors WHERE channel_id = ?;").get(channelId) as
			| { last_rowid: number }
			| undefined;
		return row?.last_rowid ?? 0;
	}

	commit(channelId: string, extraction: Extraction, lastSeq: number): void {
		this.db.exec("BEGIN;");
		try {
			for (const m of extraction.memories) {
				this.db
					.prepare(
						`INSERT INTO memories (key, kind, scope, person_id, channel_id, content, status)
             VALUES (?,?,?,?,?,?,'active')
             ON CONFLICT(key, scope, person_id, channel_id) DO UPDATE
             SET content = excluded.content, kind = excluded.kind, status = 'active', updated_at = ${NOW};`,
					)
					.run(m.key, m.kind, m.scope, m.personId, channelId, m.content);
				this.addVersion(m.key, m.scope, m.personId, channelId, m.content, "consolidação");
			}
			for (const ep of extraction.episodes) {
				this.db
					.prepare(
						`INSERT INTO episodes (key, title, summary, updated_at) VALUES (?,?,?,${NOW})
             ON CONFLICT(key) DO UPDATE SET title = excluded.title, summary = excluded.summary, updated_at = excluded.updated_at;`,
					)
					.run(ep.key, ep.title, ep.summary);
			}
			this.db
				.prepare(
					"INSERT INTO memory_cursors (channel_id, last_rowid) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET last_rowid = excluded.last_rowid;",
				)
				.run(channelId, lastSeq);
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

	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] } {
		const mine = this.db
			.prepare(
				`SELECT kind, content FROM memories
         WHERE status='active' AND scope='user' AND person_id = ? AND (kind='preference' OR kind='lesson')
         ORDER BY rowid DESC LIMIT 10;`,
			)
			.all(personId) as unknown as FamiliarMemory[];
		const group = this.db
			.prepare(
				`SELECT kind, content FROM memories
         WHERE status='active' AND scope='group' AND channel_id IN (?, '')
           AND (kind='preference' OR kind='lesson' OR kind='culture')
         ORDER BY rowid DESC LIMIT 10;`,
			)
			.all(channelId) as unknown as FamiliarMemory[];
		return { mine: mine.map((m) => ({ ...m })), group: group.map((m) => ({ ...m })) };
	}

	search(channelId: string, text: string, limit: number): MemoryHit[] {
		const match = text
			.split(/\s+/)
			.filter(Boolean)
			.map((t) => `"${t.replace(/"/g, '""')}"`)
			.join(" ");
		if (!match) return [];
		const rows = this.db
			.prepare(
				`SELECT m.key, m.kind, m.scope, m.person_id, m.content
         FROM memories_fts f JOIN memories m ON m.rowid = f.rowid
         WHERE m.status = 'active' AND m.channel_id IN (?, '') AND memories_fts MATCH ?
         ORDER BY rank LIMIT ?;`,
			)
			.all(channelId, match, limit) as unknown as Row[];
		return rows.map((r) => ({ key: r.key, kind: r.kind, scope: r.scope, personId: r.person_id, content: r.content }));
	}

	listActive(limit: number): MemoryRecord[] {
		const rows = this.db
			.prepare("SELECT * FROM memories WHERE status = 'active' ORDER BY rowid DESC LIMIT ?;")
			.all(limit) as unknown as Row[];
		return rows.map((r) => this.record(r));
	}

	find(id: number): MemoryRecord | undefined {
		const row = this.row(id);
		return row ? this.record(row) : undefined;
	}

	versions(id: number): MemoryVersion[] {
		const row = this.row(id);
		if (!row) return [];
		const rows = this.db
			.prepare("SELECT rowid, content, reason, created_at FROM memory_versions WHERE memory_key = ? ORDER BY rowid;")
			.all(row.key) as { rowid: number; content: string; reason: string; created_at: string }[];
		return rows.map((v) => ({ id: v.rowid, content: v.content, reason: v.reason, createdAt: v.created_at }));
	}

	setStatus(id: number, status: MemoryStatus, reason: string): boolean {
		const row = this.row(id);
		if (!row) return false;
		this.db.prepare(`UPDATE memories SET status = ?, updated_at = ${NOW} WHERE rowid = ?;`).run(status, id);
		this.addVersion(row.key, row.scope, row.person_id, row.channel_id, row.content, reason);
		return true;
	}

	correct(id: number, content: string, reason: string): boolean {
		const row = this.row(id);
		if (!row) return false;
		this.db
			.prepare(`UPDATE memories SET content = ?, status = 'active', updated_at = ${NOW} WHERE rowid = ?;`)
			.run(content, id);
		this.addVersion(row.key, row.scope, row.person_id, row.channel_id, content, reason);
		return true;
	}

	timeline(limit: number): LearningEvent[] {
		const versions = this.db
			.prepare("SELECT created_at AS at, memory_key, reason FROM memory_versions ORDER BY rowid DESC LIMIT ?;")
			.all(limit) as { at: string; memory_key: string; reason: string }[];
		const skills = this.db
			.prepare("SELECT created_at AS at, skill_name, usage, result, channel_id FROM skill_runs ORDER BY rowid DESC LIMIT ?;")
			.all(limit) as { at: string; skill_name: string; usage: string; result: string; channel_id: string }[];
		const events: LearningEvent[] = [
			...versions.map((v) => ({
				at: v.at,
				kind: "memory" as const,
				channelId: "",
				subject: v.memory_key,
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
		return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
	}

	private row(id: number): Row | undefined {
		return this.db.prepare("SELECT * FROM memories WHERE rowid = ?;").get(id) as unknown as Row | undefined;
	}

	private record(r: Row): MemoryRecord {
		const n = this.db.prepare("SELECT COUNT(*) AS n FROM memory_versions WHERE memory_key = ?;").get(r.key) as {
			n: number;
		};
		return {
			id: r.rowid,
			channelId: r.channel_id,
			scope: r.scope,
			personId: r.person_id,
			key: r.key,
			kind: r.kind,
			status: r.status,
			content: r.content,
			versions: n.n,
			updatedAt: r.updated_at,
		};
	}

	private addVersion(key: string, scope: string, personId: string, channelId: string, content: string, reason: string): void {
		this.db
			.prepare(
				"INSERT INTO memory_versions (memory_key, scope, person_id, channel_id, content, reason) VALUES (?,?,?,?,?,?);",
			)
			.run(key, scope, personId, channelId, content, reason);
	}
}
