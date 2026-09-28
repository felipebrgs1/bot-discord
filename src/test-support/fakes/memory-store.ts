import type { LearningEvent, MemoryAdmin, MemoryRecord, MemoryVersion } from "../../application/ports/memory-admin.ts";
import type { MemoryStore } from "../../application/ports/memory-store.ts";
import type { Extraction, FamiliarMemory, MemoryHit, MemoryStatus } from "../../domain/memory.ts";
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
	updatedAt: string;
}

interface VersionRow extends MemoryVersion {
	memoryId: number;
	key: string;
}

export class FakeMemoryStore implements MemoryStore, MemoryAdmin {
	readonly rows: Row[] = [];
	readonly versionRows: VersionRow[] = [];
	private readonly cursors = new Map<string, number>();
	private tick = 0;

	cursor(channelId: string): number {
		return this.cursors.get(channelId) ?? 0;
	}

	commit(channelId: string, extraction: Extraction, lastSeq: number): void {
		for (const m of extraction.memories) {
			let row = this.rows.find(
				(r) => r.key === m.key && r.scope === m.scope && r.personId === m.personId && r.channelId === channelId,
			);
			if (row) {
				row.content = m.content;
				row.kind = m.kind;
				row.status = "active";
				row.updatedAt = this.now();
			} else {
				row = { id: this.rows.length + 1, ...m, channelId, status: "active", updatedAt: this.now() };
				this.rows.push(row);
			}
			this.version(row, m.content, "consolidação");
		}
		this.cursors.set(channelId, lastSeq);
	}

	familiar(personId: string, channelId: string): { mine: FamiliarMemory[]; group: FamiliarMemory[] } {
		const active = [...this.rows].reverse().filter((r) => r.status === "active");
		const pick = (r: Row): FamiliarMemory => ({ kind: r.kind, content: r.content });
		return {
			mine: active
				.filter((r) => r.scope === "user" && r.personId === personId && ["preference", "lesson"].includes(r.kind))
				.slice(0, 10)
				.map(pick),
			group: active
				.filter(
					(r) =>
						r.scope === "group" &&
						(r.channelId === channelId || r.channelId === "") &&
						["preference", "lesson", "culture"].includes(r.kind),
				)
				.slice(0, 10)
				.map(pick),
		};
	}

	search(channelId: string, text: string, limit: number): MemoryHit[] {
		return this.rows
			.filter((r) => r.status === "active" && (r.scope === "user" || r.channelId === channelId || r.channelId === ""))
			.map((r) => ({ r, n: matchCount(text, r.content) }))
			.filter(({ n }) => n > 0)
			.sort((a, b) => b.n - a.n)
			.map(({ r }) => r)
			.slice(0, limit)
			.map((r) => ({ key: r.key, kind: r.kind, scope: r.scope, personId: r.personId, content: r.content }));
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
