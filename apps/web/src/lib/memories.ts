import type { MemoryItem } from "@elmatadore/api";

export interface MemoryFilter {
	/** "all" ou um kind. */
	kind: string;
	query: string;
}

export function filterMemories(items: readonly MemoryItem[], { kind, query }: MemoryFilter): MemoryItem[] {
	const needle = query.trim().toLowerCase();
	return items.filter((item) => {
		if (kind !== "all" && item.kind !== kind) return false;
		if (!needle) return true;
		return [item.content, item.key, item.user_id ?? ""].some((text) => text.toLowerCase().includes(needle));
	});
}

export function kindCounts(items: readonly MemoryItem[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1]);
}
