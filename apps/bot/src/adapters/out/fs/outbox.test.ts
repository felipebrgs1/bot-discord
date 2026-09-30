import { afterAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

describe("FsOutbox.save", () => {
	it("grava os bytes decodificados do base64", async () => {
		const base = await mkdtemp(join(tmpdir(), "outbox-"));
		dirs.push(base);
		const path = await new FsOutbox(base).save("c1", "img.png", Buffer.from("PNG!").toString("base64"));
		expect(await readFile(path, "utf8")).toBe("PNG!");
	});
});
