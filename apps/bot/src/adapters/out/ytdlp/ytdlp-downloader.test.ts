import { afterAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Outbox } from "../../../application/ports/outbox.ts";
import { YtDlpDownloader } from "./ytdlp-downloader.ts";

const MB = 1 << 20;
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
	save: async () => "",
});

async function script(dir: string, name: string, body: string): Promise<string> {
	const bin = join(dir, name);
	await writeFile(bin, `#!/bin/sh\n${body}`);
	await chmod(bin, 0o755);
	return bin;
}

const probeJson = (formats: unknown[], duration = 60) => JSON.stringify({ duration, formats });

/**
 * yt-dlp falso: com -J imprime `probe`; senao grava v.mp4 (`bytes` bytes) na
 * pasta do template -o. Cada chamada vira uma linha em `args`.
 */
async function fakeYtDlp(dir: string, probe: string, bytes = 5): Promise<string> {
	await writeFile(join(dir, "probe.json"), probe);
	return script(
		dir,
		"yt-dlp",
		`echo "$*" >> "${dir}/args"
case " $* " in *" -J "*) echo "WARNING: aviso qualquer" >&2; cat "${dir}/probe.json"; exit 0;; esac
while [ "$1" != "-o" ]; do shift; done
head -c ${bytes} /dev/zero > "$(dirname "$2")/v.mp4"
`,
	);
}

/** ffprobe/ffmpeg falsos: ffmpeg so gera arquivo pequeno na altura `fitsAt`. */
async function fakeFfmpeg(dir: string, fitsAt: number) {
	const ffprobe = await script(dir, "ffprobe", "echo 60\n");
	const ffmpeg = await script(
		dir,
		"ffmpeg",
		`for a; do out="$a"; case "$a" in scale=*) echo "$a" >> "${dir}/scales";; esac; done
case " $* " in *"min(${fitsAt},ih)"*) head -c 1000 /dev/zero > "$out";; *) head -c ${30 * MB} /dev/zero > "$out";; esac
`,
	);
	return { ffprobe, ffmpeg };
}

const lines = async (path: string) => (await readFile(path, "utf8")).trim().split("\n");

const formats = [
	{ format_id: "1080", height: 1080, vcodec: "avc1", acodec: "none", filesize: 40 * MB },
	{ format_id: "720", height: 720, vcodec: "avc1", acodec: "none", filesize_approx: 15 * MB },
	{ format_id: "a", vcodec: "none", acodec: "mp4a", filesize: 2 * MB },
];

describe("YtDlpDownloader", () => {
	it("baixa para a pasta do canal no outbox", async () => {
		const dir = await tempDir();
		const outbox = diskOutbox(join(dir, "outbox"));
		const r = await new YtDlpDownloader(await fakeYtDlp(dir, probeJson(formats)), outbox).download("https://x.com/a", "c1");
		expect(r).toEqual({ kind: "done", files: ["v.mp4 (5 bytes)"], dropped: [] });
		expect(await readdir(outbox.dirFor("c1"))).toEqual(["v.mp4"]);
	});

	it("sonda os formatos e baixa a maior resolucao que cabe em 20 MB", async () => {
		const dir = await tempDir();
		await new YtDlpDownloader(await fakeYtDlp(dir, probeJson(formats)), diskOutbox(dir)).download("https://x.com/a", "c1");
		const [probe, download] = await lines(join(dir, "args"));
		expect(probe).toContain("-J");
		expect(download).toContain("-f 720+a ");
	});

	it("codec desconhecido conta como presente, como no audio HLS do X", async () => {
		const dir = await tempDir();
		const probe = probeJson([
			{ format_id: "hls-audio-128000-Audio", vcodec: "none", tbr: 128 },
			{ format_id: "hls-2176", height: 720, vcodec: "avc1.640020", acodec: "none", tbr: 2176 },
		]);
		await new YtDlpDownloader(await fakeYtDlp(dir, probe), diskOutbox(dir)).download("https://x.com/a", "c1");
		const [, download] = await lines(join(dir, "args"));
		expect(download).toContain("-f hls-2176+hls-audio-128000-Audio ");
	});

	it("sem formato de tamanho conhecido que caiba, baixa ate 720p para recomprimir", async () => {
		const dir = await tempDir();
		const probe = probeJson([{ format_id: "hls", height: 1080, vcodec: "avc1", acodec: "mp4a" }], 0);
		await new YtDlpDownloader(await fakeYtDlp(dir, probe), diskOutbox(dir)).download("https://x.com/a", "c1");
		const [, download] = await lines(join(dir, "args"));
		expect(download).toContain("-f bv*[height<=720]+ba/b[height<=720]/bv*+ba/b ");
	});

	it("sonda ilegivel tambem cai no seletor de reserva", async () => {
		const dir = await tempDir();
		await new YtDlpDownloader(await fakeYtDlp(dir, "lixo"), diskOutbox(dir)).download("https://x.com/a", "c1");
		const [, download] = await lines(join(dir, "args"));
		expect(download).toContain("-f bv*[height<=720]+ba/b[height<=720]/bv*+ba/b ");
	});

	it("arquivo acima do teto e recomprimido descendo ate 240p", async () => {
		const dir = await tempDir();
		const outbox = diskOutbox(join(dir, "outbox"));
		const tools = await fakeFfmpeg(dir, 240);
		const r = await new YtDlpDownloader(await fakeYtDlp(dir, probeJson([]), 25 * MB), outbox, tools).download(
			"https://x.com/a",
			"c1",
		);
		expect(await lines(join(dir, "scales"))).toEqual([
			"scale=-2:min(720,ih)",
			"scale=-2:min(480,ih)",
			"scale=-2:min(360,ih)",
			"scale=-2:min(240,ih)",
		]);
		expect(r).toEqual({ kind: "done", files: ["v.mp4 (comprimido de 25.0 MB p/ 0.0 MB)"], dropped: [] });
		expect((await stat(join(outbox.dirFor("c1"), "v.mp4"))).size).toBe(1000);
	});

	it("nao cabendo nem em 240p, descarta", async () => {
		const dir = await tempDir();
		const outbox = diskOutbox(join(dir, "outbox"));
		const tools = await fakeFfmpeg(dir, 144);
		const r = await new YtDlpDownloader(await fakeYtDlp(dir, probeJson([]), 25 * MB), outbox, tools).download(
			"https://x.com/a",
			"c1",
		);
		expect(r).toEqual({ kind: "done", files: [], dropped: ["v.mp4 (25.0 MB, não coube: não coube nem comprimido)"] });
		expect(await readdir(outbox.dirFor("c1"))).toEqual([]);
	});

	it("yt-dlp que falha devolve a saida", async () => {
		const dir = await tempDir();
		const r = await new YtDlpDownloader("/bin/false", diskOutbox(dir)).download("https://x.com/a", "c1");
		expect(r.kind).toBe("failed");
	});
});
