import type { LearningEvent, MemoryAdmin, MemoryRecord, MemoryVersion } from "../../application/ports/memory-admin.ts";
import type { MemoryStore } from "../../application/ports/memory-store.ts";
import type { Extraction, FamiliarMemory, MemoryHit, MemoryRef, MemoryStatus } from "../../domain/memory.ts";
import { matchCount } from "./search.ts";

interface Row {
	id: number;
	key: string;
	kind: string;
	scope: string;
	personId: string;
	channelId: string;
	content: string;
	status: string;
	seenCount: number;
	updatedAt: string;
}

interface VersionRow extends MemoryVersion {
	memoryId: number;
	key: string;
}

interface EpisodeRow {
	channelId: string;
	key: string;
	title: string;
	summary: string;
}

const LIMIT = 10;
const KNOWN_LIMIT = 60;

/** Preferencia/licao antes de fato; depois mais reafirmada; depois mais recente. */
function byRank(a: Row, b: Row): number {
	const kind = (r: Row) => (r.kind === "preference" || r.kind === "lesson" ? 0 : 1);
	return kind(a) - kind(b) || b.seenCount - a.seenCount || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
}

const hit = (r: Row): MemoryHit => ({ key: r.key, kind: r.kind, scope: r.scope, personId: r.personId, content: r.content });

export class FakeMemoryStore implements MemoryStore, MemoryAdmin {
	readonly rows: Row[] = [];
	readonly versionRows: VersionRow[] = [];
	readonly episodes: EpisodeRow[] = [];
	private readonly cursors = new Map<string, number>();
	private tick = 0;

	cursor(channelId: string): number {
		return this.cursors.get(channelId) ?? 0;
	}

	commit(channelId: string, extraction: Extraction, lastSeq: number): void {
		for (const m of extraction.memories) {
			const home = m.scope === "user" ? "" : channelId;
			const row = this.rows.find(
				(r) => r.key === m.key && r.scope === m.scope && r.personId === m.personId && r.channelId === home,
			);
			if (!row) {
				const created = { id: this.rows.length + 1, ...m, channelId: home, status: "active", seenCount: 1, updatedAt: this.now() };
				this.rows.push(created);
				this.version(created, m.content, "consolidação");
			} else if (row.content === m.content && row.status === "active") {
				this.reaffirm(row);
			} else {
				Object.assign(row, { content: m.content, kind: m.kind, status: "active", updatedAt: this.now() });
				this.version(row, m.content, "consolidação");
			}
		}
		for (const f of extraction.forget) {
			const row = this.target(channelId, f);
			if (!row) continue;
			row.status = "suppressed";
			row.updatedAt = this.now();
			this.version(row, row.content, f.reason ? `consolidação: ${f.reason}` : "consolidação");
		}
		for (const c of extraction.confirm) {
			const row = this.target(channelId, c);
			if (row) this.reaffirm(row);
		}
		for (const e of extraction.episodes) {
			const existing = this.episodes.find((x) => x.channelId === channelId && x.key === e.key);
			if (existing) Object.assign(existing, { title: e.title, summary: e.summary });
			else this.episodes.push({ channelId, ...e });
		}
		this.cursors.set(channelId, lastSeq);
	}

	known(channelId: string, personIds: readonly string[]): MemoryHit[] {
		return this.active()
			.filter((r) => (r.scope === "user" ? personIds.includes(r.personId) : this.inChannel(r, channelId)))
			.sort(byRank)
			.slice(0, KNOWN_LIMIT)
			.map(hit);
	}

	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] } {
		const pick = (r: Row): FamiliarMemory => ({ kind: r.kind, content: r.content });
		return {
			mine: this.active()
				.filter((r) => r.scope === "user" && r.personId === personId && ["preference", "lesson", "fact"].includes(r.kind))
				.sort(byRank)
				.slice(0, LIMIT)
				.map(pick),
			group: this.active()
				.filter((r) => r.scope === "group" && this.inChannel(r, channelId) && ["preference", "lesson", "culture"].includes(r.kind))
				.sort(byRank)
				.slice(0, LIMIT)
				.map(pick),
		};
	}

	search(channelId: string, text: string, limit: number): MemoryHit[] {
		const memories = this.active()
			.filter((r) => r.scope === "user" || this.inChannel(r, channelId))
			.map((r) => ({ hit: hit(r), n: matchCount(text, r.content) }));
		const episodes = this.episodes
			.filter((e) => e.channelId === channelId || e.channelId === "")
			.map((e) => {
				const content = `${e.title}: ${e.summary}`;
				return { hit: { key: e.key, kind: "episode", scope: "group", personId: "", content }, n: matchCount(text, content) };
			});
		return [...memories, ...episodes]
			.filter(({ n }) => n > 0)
			.sort((a, b) => b.n - a.n)
			.slice(0, limit)
			.map(({ hit: h }) => h);
	}

	private active(): Row[] {
		return [...this.rows].reverse().filter((r) => r.status === "active");
	}

	private inChannel(r: Row, channelId: string): boolean {
		return r.channelId === channelId || r.channelId === "";
	}

	private target(channelId: string, ref: MemoryRef): Row | undefined {
		return this.rows.find(
			(r) =>
				r.key === ref.key &&
				r.scope === ref.scope &&
				r.personId === ref.personId &&
				(ref.scope === "user" || this.inChannel(r, channelId)),
		);
	}

	private reaffirm(row: Row): void {
		row.seenCount += 1;
		row.updatedAt = this.now();
	}

	listActive(limit: number): MemoryRecord[] {
		return [...this.rows]
			.reverse()
			.filter((r) => r.status === "active")
			.slice(0, limit)
			.map((r) => this.record(r));
	}

	find(id: number): MemoryRecord | undefined {
		const row = this.rows.find((r) => r.id === id);
		return row ? this.record(row) : undefined;
	}

	versions(id: number): MemoryVersion[] {
		const row = this.rows.find((r) => r.id === id);
		return row
			? this.versionRows
					.filter((v) => v.memoryId === row.id)
					.map(({ id: vid, content, reason, createdAt }) => ({ id: vid, content, reason, createdAt }))
			: [];
	}

	setStatus(id: number, status: MemoryStatus, reason: string): boolean {
		const row = this.rows.find((r) => r.id === id);
		if (!row) return false;
		row.status = status;
		row.updatedAt = this.now();
		this.version(row, row.content, reason);
		return true;
	}

	correct(id: number, content: string, reason: string): boolean {
		const row = this.rows.find((r) => r.id === id);
		if (!row) return false;
		row.content = content;
		row.status = "active";
		row.updatedAt = this.now();
		this.version(row, content, reason);
		return true;
	}

	timeline(limit: number): LearningEvent[] {
		return [...this.versionRows]
			.reverse()
			.slice(0, limit)
			.map((v) => ({ at: v.createdAt, kind: "memory", channelId: "", subject: v.key, detail: v.reason || "versão registrada" }));
	}

	private record(r: Row): MemoryRecord {
		return {
			id: r.id,
			channelId: r.channelId,
			scope: r.scope,
			personId: r.personId,
			key: r.key,
			kind: r.kind,
			status: r.status,
			content: r.content,
			versions: this.versionRows.filter((v) => v.memoryId === r.id).length,
			updatedAt: r.updatedAt,
		};
	}

	private version(row: Row, content: string, reason: string): void {
		this.versionRows.push({
			id: this.versionRows.length + 1,
			memoryId: row.id,
			key: row.key,
			content,
			reason,
			createdAt: this.now(),
		});
	}

	private now(): string {
		this.tick += 1;
		return new Date(this.tick * 1000).toISOString();
	}
}
