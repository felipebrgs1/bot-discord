export interface LogEntry {
	id: number;
	time: string;
	level: "debug" | "info" | "warn" | "error";
	msg: string;
	attrs?: Record<string, unknown>;
}

/** Leitura incremental do log (painel). */
export interface LogFeed {
	after(cursor: number, limit: number): { entries: LogEntry[]; cursor: number };
}
