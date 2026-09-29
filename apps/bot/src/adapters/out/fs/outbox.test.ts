import { afterAll, describe } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outboxContract } from "../../../application/ports/outbox.contract.ts";
import { FsOutbox } from "./outbox.ts";

const dirs: string[] = [];
afterAll(async () => {
	for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe("FsOutbox", () => {
	outboxContract(async () => {
		const base = await mkdtemp(join(tmpdir(), "outbox-"));
		dirs.push(base);
		const outbox = new FsOutbox(base);
		return {
			outbox,
			put: async (channelId, name) => {
				await mkdir(outbox.dirFor(channelId), { recursive: true });
				await writeFile(join(outbox.dirFor(channelId), name), "x");
			},
		};
	});
});
