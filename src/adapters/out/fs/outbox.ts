import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Outbox } from "../../../application/ports/outbox.ts";

/** outbox/<canal>/ no disco. */
export class FsOutbox implements Outbox {
	private readonly baseDir: string;

	constructor(baseDir: string) {
		this.baseDir = baseDir;
	}

	dirFor(channelId: string): string {
		return join(this.baseDir, channelId.replace(/[^a-zA-Z0-9_-]/g, "_"));
	}

	async pending(channelId: string): Promise<string[]> {
		const dir = this.dirFor(channelId);
		const names = await readdir(dir).catch(() => [] as string[]);
		return names.filter((n) => !n.startsWith(".")).map((n) => join(dir, n));
	}

	async discard(path: string): Promise<void> {
		await rm(path, { force: true });
	}
}
