import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

	/** Grava como oculto e renomeia: a entrega nunca pega arquivo pela metade. */
	async save(channelId: string, name: string, base64: string): Promise<string> {
		const dir = this.dirFor(channelId);
		await mkdir(dir, { recursive: true });
		const path = join(dir, basename(name));
		const partial = join(dir, `.${basename(name)}.part`);
		await writeFile(partial, Buffer.from(base64, "base64"));
		await rename(partial, path);
		return path;
	}
}
