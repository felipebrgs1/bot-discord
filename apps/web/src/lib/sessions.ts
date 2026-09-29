import type { ChatSession } from "@elmatadore/api";

export interface SessionGroup {
	label: string;
	items: ChatSession[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Agrupa por dia da ultima atualizacao, relativo a `now`. */
export function groupSessions(sessions: readonly ChatSession[], now: Date): SessionGroup[] {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const start = today.getTime();
	const bucket = (iso: string): string => {
		const at = new Date(iso).getTime();
		if (at >= start) return "Hoje";
		if (at >= start - DAY) return "Ontem";
		if (at >= start - 7 * DAY) return "7 dias";
		return "Antes";
	};
	const groups: SessionGroup[] = ["Hoje", "Ontem", "7 dias", "Antes"].map((label) => ({ label, items: [] }));
	const sorted = [...sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
	for (const s of sorted) groups.find((g) => g.label === bucket(s.updated_at))?.items.push(s);
	return groups.filter((g) => g.items.length > 0);
}
