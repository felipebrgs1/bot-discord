import type { DatabaseSync } from "node:sqlite";
import type { LearningEvent, MemoryAdmin, MemoryRecord, MemoryVersion } from "../../../application/ports/memory-admin.ts";
import type { MemoryStore } from "../../../application/ports/memory-store.ts";
import type {
	ExtractedMemory,
	Extraction,
	FamiliarMemory,
	MemoryHit,
	MemoryRef,
	MemoryStatus,
} from "../../../domain/memory.ts";
import { ftsMatch } from "./fts.ts";

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
/** Preferencia/licao antes de fato; depois mais reafirmada; depois mais recente. */
const RANK =
	"CASE WHEN kind IN ('preference', 'lesson') THEN 0 ELSE 1 END, seen_count DESC, updated_at DESC, rowid DESC";
const LIMIT = 10;
const KNOWN_LIMIT = 60;

const hit = (r: Row): MemoryHit => ({ key: r.key, kind: r.kind, scope: r.scope, personId: r.person_id, content: r.content });

/** Tabelas `memories` (+FTS5), `memory_versions`, `episodes` (+FTS5), `memory_cursors`. */
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
			for (const m of extraction.memories) this.upsert(channelId, m);
			for (const f of extraction.forget) {
				const row = this.target(channelId, f);
				if (!row) continue;
				this.db.prepare(`UPDATE memories SET status = 'suppressed', updated_at = ${NOW} WHERE rowid = ?;`).run(row.rowid);
				this.addVersion(row, row.content, f.reason ? `consolidação: ${f.reason}` : "consolidação");
			}
			for (const c of extraction.confirm) {
				const row = this.target(channelId, c);
				if (row) this.reaffirm(row.rowid);
			}
			for (const ep of extraction.episodes) {
				this.db
					.prepare(
						`INSERT INTO episodes (channel_id, key, title, summary, updated_at) VALUES (?,?,?,?,${NOW})
             ON CONFLICT(channel_id, key) DO UPDATE
             SET title = excluded.title, summary = excluded.summary, updated_at = excluded.updated_at;`,
					)
					.run(channelId, ep.key, ep.title, ep.summary);
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

	known(channelId: string, personIds: readonly string[]): MemoryHit[] {
		const people = personIds.map(() => "?").join(",");
		const rows = this.db
			.prepare(
				`SELECT * FROM memories WHERE status = 'active'
           AND ((scope = 'group' AND channel_id IN (?, '')) OR (scope = 'user' AND person_id IN (${people || "NULL"})))
         ORDER BY ${RANK} LIMIT ${KNOWN_LIMIT};`,
			)
			.all(channelId, ...personIds) as unknown as Row[];
		return rows.map(hit);
	}

	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] } {
		const mine = this.db
			.prepare(
				`SELECT kind, content FROM memories
         WHERE status = 'active' AND scope = 'user' AND person_id = ? AND kind IN ('preference', 'lesson', 'fact')
         ORDER BY ${RANK} LIMIT ${LIMIT};`,
			)
			.all(personId) as unknown as FamiliarMemory[];
		const group = this.db
			.prepare(
				`SELECT kind, content FROM memories
         WHERE status = 'active' AND scope = 'group' AND channel_id IN (?, '')
           AND kind IN ('preference', 'lesson', 'culture')
         ORDER BY ${RANK} LIMIT ${LIMIT};`,
			)
			.all(channelId) as unknown as FamiliarMemory[];
		return { mine: mine.map((m) => ({ ...m })), group: group.map((m) => ({ ...m })) };
	}

	search(channelId: string, text: string, limit: number): MemoryHit[] {
		const match = ftsMatch(text);
		if (!match) return [];
		const rows = this.db
			.prepare(
				`SELECT * FROM (
           SELECT m.key, m.kind, m.scope, m.person_id, m.content, f.rank AS score
           FROM memories_fts f JOIN memories m ON m.rowid = f.rowid
           WHERE m.status = 'active' AND (m.scope = 'user' OR m.channel_id IN (?, '')) AND memories_fts MATCH ?
           UNION ALL
           SELECT e.key, 'episode', 'group', '', e.title || ': ' || e.summary, f.rank
           FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid
           WHERE e.channel_id IN (?, '') AND episodes_fts MATCH ?
         ) ORDER BY score LIMIT ?;`,
			)
			.all(channelId, match, channelId, match, limit) as unknown as Row[];
		return rows.map(hit);
	}

	/** Mesma key atualiza; mesmo conteudo ativo so reafirma (sem versao nova). */
	private upsert(channelId: string, m: ExtractedMemory): void {
		const home = m.scope === "user" ? "" : channelId;
		const existing = this.db
			.prepare("SELECT * FROM memories WHERE key = ? AND scope = ? AND person_id = ? AND channel_id = ?;")
			.get(m.key, m.scope, m.personId, home) as unknown as Row | undefined;
		if (existing?.content === m.content && existing.status === "active") {
			this.reaffirm(existing.rowid);
			return;
		}
		this.db
			.prepare(
				`INSERT INTO memories (key, kind, scope, person_id, channel_id, content, status)
         VALUES (?,?,?,?,?,?,'active')
         ON CONFLICT(key, scope, person_id, channel_id) DO UPDATE
         SET content = excluded.content, kind = excluded.kind, status = 'active', updated_at = ${NOW};`,
			)
			.run(m.key, m.kind, m.scope, m.personId, home, m.content);
		const saved = this.db
			.prepare("SELECT * FROM memories WHERE key = ? AND scope = ? AND person_id = ? AND channel_id = ?;")
			.get(m.key, m.scope, m.personId, home) as unknown as Row;
		this.addVersion(saved, m.content, "consolidação");
	}

	/** Memoria apontada pelo modelo: de pessoa (global) ou do grupo no canal/global. */
	private target(channelId: string, ref: MemoryRef): Row | undefined {
		return this.db
			.prepare(
				`SELECT * FROM memories WHERE key = ? AND scope = ? AND person_id = ?
           AND (scope = 'user' OR channel_id IN (?, '')) ORDER BY channel_id DESC LIMIT 1;`,
			)
			.get(ref.key, ref.scope, ref.personId, channelId) as unknown as Row | undefined;
	}

	private reaffirm(rowid: number): void {
		this.db.prepare(`UPDATE memories SET seen_count = seen_count + 1, updated_at = ${NOW} WHERE rowid = ?;`).run(rowid);
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
			.prepare("SELECT rowid, content, reason, created_at FROM memory_versions WHERE memory_id = ? ORDER BY rowid;")
			.all(row.rowid) as { rowid: number; content: string; reason: string; created_at: string }[];
		return rows.map((v) => ({ id: v.rowid, content: v.content, reason: v.reason, createdAt: v.created_at }));
	}

	setStatus(id: number, status: MemoryStatus, reason: string): boolean {
		const row = this.row(id);
		if (!row) return false;
		this.db.prepare(`UPDATE memories SET status = ?, updated_at = ${NOW} WHERE rowid = ?;`).run(status, id);
		this.addVersion(row, row.content, reason);
		return true;
	}

	correct(id: number, content: string, reason: string): boolean {
		const row = this.row(id);
		if (!row) return false;
		this.db
			.prepare(`UPDATE memories SET content = ?, status = 'active', updated_at = ${NOW} WHERE rowid = ?;`)
			.run(content, id);
		this.addVersion(row, content, reason);
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
		const n = this.db.prepare("SELECT COUNT(*) AS n FROM memory_versions WHERE memory_id = ?;").get(r.rowid) as {
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

	private addVersion(memory: Row, content: string, reason: string): void {
		this.db
			.prepare(
				"INSERT INTO memory_versions (memory_id, memory_key, scope, person_id, channel_id, content, reason) VALUES (?,?,?,?,?,?,?);",
			)
			.run(memory.rowid, memory.key, memory.scope, memory.person_id, memory.channel_id, content, reason);
	}
}
