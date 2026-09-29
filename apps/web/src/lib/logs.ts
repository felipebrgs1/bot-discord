import type { LogEntry, LogLevel } from "@elmatadore/api";

export type LevelFilter = "all" | LogLevel;

export interface LogFilter {
	level: LevelFilter;
	query: string;
}

export function filterLogs(entries: readonly LogEntry[], { level, query }: LogFilter): LogEntry[] {
	const needle = query.trim().toLowerCase();
	return entries.filter((e) => {
		if (level !== "all" && e.level !== level) return false;
		if (!needle) return true;
		return e.msg.toLowerCase().includes(needle) || JSON.stringify(e.attrs ?? {}).toLowerCase().includes(needle);
	});
}

/** Buffer do cliente: so as ultimas `max` entradas. */
export const appendLogs = (current: readonly LogEntry[], incoming: readonly LogEntry[], max: number): LogEntry[] =>
	[...current, ...incoming].slice(-max);

export function formatAttr(value: unknown): string {
	if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1);
	if (typeof value === "string") return value;
	return JSON.stringify(value);
}
