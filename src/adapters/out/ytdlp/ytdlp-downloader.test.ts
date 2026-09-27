import { afterAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Outbox } from "../../../application/ports/outbox.ts";
import { YtDlpDownloader } from "./ytdlp-downloader.ts";

const dirs: string[] = [];
afterAll(async () => {
	for (const d of dirs) await rm(d, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
	const d = await mkdtemp(join(tmpdir(), "ytdlp-"));
	dirs.push(d);
	return d;
}

/** Outbox minimo em disco: pasta por canal dentro de `base`. */
const diskOutbox = (base: string): Outbox => ({
	dirFor: (channelId) => join(base, channelId),
	pending: async () => [],
	discard: async () => undefined,
});

/** yt-dlp falso: grava v.mp4 na pasta do template -o. */
async function fakeYtDlp(dir: string): Promise<string> {
	const bin = join(dir, "yt-dlp");
	await writeFile(
		bin,
		'#!/bin/sh\nwhile [ "$1" != "-o" ]; do shift; done\nprintf dados > "$(dirname "$2")/v.mp4"\n',
	);
	await chmod(bin, 0o755);
	return bin;
}

describe("YtDlpDownloader", () => {
	it("baixa para a pasta do canal no outbox", async () => {
		const dir = await tempDir();
		const outbox = diskOutbox(join(dir, "outbox"));
		const r = await new YtDlpDownloader(await fakeYtDlp(dir), outbox).download("https://x.com/a", "c1");
		expect(r).toEqual({ kind: "done", files: ["v.mp4 (5 bytes)"], dropped: [] });
		expect(await readdir(outbox.dirFor("c1"))).toEqual(["v.mp4"]);
	});

	it("yt-dlp que falha devolve a saida", async () => {
		const dir = await tempDir();
		const r = await new YtDlpDownloader("/bin/false", diskOutbox(dir)).download("https://x.com/a", "c1");
		expect(r.kind).toBe("failed");
	});
});
