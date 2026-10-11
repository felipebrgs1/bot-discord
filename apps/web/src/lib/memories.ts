import type { MemoryBlock } from "@elmatadore/api";

/** Busca no nome, no id do dono e nas entradas. */
export function filterBlocks(blocks: readonly MemoryBlock[], query: string): MemoryBlock[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...blocks];
	return blocks.filter((b) => [b.name, b.owner_id, ...b.entries].some((text) => text.toLowerCase().includes(needle)));
}

/** Editor: uma entrada por linha. */
export function entriesFromText(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

/** Mesma conta do bot (blockSize): entradas + uma quebra entre elas. */
export function draftSize(entries: readonly string[]): number {
	return entries.reduce((n, e) => n + e.length, 0) + Math.max(entries.length - 1, 0);
}

export type UsageLevel = "ok" | "high" | "over";

export function usageLevel(size: number, limit: number): UsageLevel {
	if (size > limit) return "over";
	return size > limit * 0.8 ? "high" : "ok";
}
