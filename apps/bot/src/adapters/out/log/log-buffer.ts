/**
 * Log em memoria (anel de 2000): o backend escreve, o painel le por cursor.
 * stdout recebe tudo.
 */

import type { LogEntry, LogFeed } from "../../../application/ports/log-feed.ts";
import type { Logger } from "../../../application/ports/logger.ts";

const CAPACITY = 2000;

export class LogBuffer implements Logger, LogFeed {
	private seq = 0;
	private readonly records: LogEntry[] = [];
	private readonly print: (line: string, level: LogEntry["level"]) => void;

	constructor(print: (line: string, level: LogEntry["level"]) => void = defaultPrint) {
		this.print = print;
	}

	info(message: string): void {
		this.log("info", message);
	}

	warn(message: string): void {
		this.log("warn", message);
	}

	error(message: string): void {
		this.log("error", message);
	}

	log(level: LogEntry["level"], msg: string, attrs?: Record<string, unknown>): void {
		this.seq += 1;
		this.records.push({ id: this.seq, time: new Date().toISOString(), level, msg, attrs });
		if (this.records.length > CAPACITY) this.records.splice(0, this.records.length - CAPACITY);
		this.print(attrs ? `${msg} ${JSON.stringify(attrs)}` : msg, level);
	}

	after(cursor: number, limit: number): { entries: LogEntry[]; cursor: number } {
		return { entries: this.records.filter((r) => r.id > cursor).slice(-limit), cursor: this.seq };
	}
}

function defaultPrint(line: string, level: LogEntry["level"]): void {
	if (level === "error") console.error(line);
	else console.log(line);
}
