import type { LearningEvent, MemoryAdmin, MemoryBlockRecord, MemoryBlockVersion } from "../../application/ports/memory-admin.ts";
import type { MemoryStore } from "../../application/ports/memory-store.ts";
import type { MemoryBlockRef, MemoryScope } from "../../domain/memory.ts";

interface VersionRow extends MemoryBlockVersion {
	scope: MemoryScope;
	ownerId: string;
}

const keyOf = (scope: MemoryScope, ownerId: string) => `${scope}:${ownerId}`;

export class FakeMemoryStore implements MemoryStore, MemoryAdmin {
	readonly versionRows: VersionRow[] = [];
	private readonly blocksByKey = new Map<string, MemoryBlockRecord>();
	private readonly cursors = new Map<string, number>();
	private tick = 0;

	read(ref: MemoryBlockRef): string[] {
		return [...(this.blocksByKey.get(keyOf(ref.scope, ref.ownerId))?.entries ?? [])];
	}

	write(ref: MemoryBlockRef, entries: readonly string[], reason: string): void {
		const at = this.now();
		this.blocksByKey.set(keyOf(ref.scope, ref.ownerId), { ...ref, name: ref.ownerId, entries: [...entries], updatedAt: at });
		this.versionRows.push({ id: this.versionRows.length + 1, ...ref, entries: [...entries], reason, createdAt: at });
	}

	cursor(channelId: string): number {
		return this.cursors.get(channelId) ?? 0;
	}

	setCursor(channelId: string, seq: number): void {
		this.cursors.set(channelId, seq);
	}

	blocks(): MemoryBlockRecord[] {
		const scopeRank = (b: MemoryBlockRecord) => (b.scope === "group" ? 0 : 1);
		return [...this.blocksByKey.values()]
			.map((b) => ({ ...b, entries: [...b.entries] }))
			.sort((a, b) => scopeRank(a) - scopeRank(b) || (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
	}

	versions(scope: MemoryScope, ownerId: string): MemoryBlockVersion[] {
		return this.versionRows
			.filter((v) => v.scope === scope && v.ownerId === ownerId)
			.map(({ id, entries, reason, createdAt }) => ({ id, entries: [...entries], reason, createdAt }));
	}

	timeline(limit: number): LearningEvent[] {
		return [...this.versionRows]
			.reverse()
			.slice(0, limit)
			.map((v) => ({
				at: v.createdAt,
				kind: "memory" as const,
				channelId: v.scope === "group" ? v.ownerId : "",
				subject: keyOf(v.scope, v.ownerId),
				detail: v.reason,
			}));
	}

	private now(): string {
		this.tick += 1;
		return new Date(Date.UTC(2026, 0, 1, 0, 0, this.tick)).toISOString();
	}
}
