import type { Logger } from "../../application/ports/logger.ts";

export class FakeLogger implements Logger {
	readonly lines: string[] = [];

	info(message: string): void {
		this.lines.push(`info ${message}`);
	}

	warn(message: string): void {
		this.lines.push(`warn ${message}`);
	}
}
