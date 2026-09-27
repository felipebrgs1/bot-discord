/**
 * MediaDownloader via yt-dlp para o outbox do canal. Arquivo acima do teto
 * e recomprimido com ffmpeg (720p, depois 480p); se nao couber, descartado.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MediaDownloader, MediaResult } from "../../../application/ports/media-downloader.ts";
import type { Outbox } from "../../../application/ports/outbox.ts";

const MAX_BYTES = 20 << 20;
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
			const out = `${stdout}${stderr}`.trim();
			resolve(err ? { ok: false, out: out || err.message } : { ok: true, out });
		});
	});
}

async function compressToFit(path: string, maxBytes: number): Promise<void> {
	const probe = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], 30_000);
	const duration = Number.parseFloat(probe.out.trim());
	if (!probe.ok || !Number.isFinite(duration) || duration <= 0) throw new Error("duração ilegível");
	const target = maxBytes * 0.92;
	const out = `${path}.fit.mp4`;
	for (const [height, audio] of [
		[720, 96],
		[480, 64],
	] as const) {
		const videoK = Math.max(150, Math.floor((target * 8) / duration / 1000 - audio));
		await rm(out, { force: true });
		const r = await run(
			"ffmpeg",
			[
				"-y", "-hide_banner", "-loglevel", "error", "-i", path,
				"-vf", `scale=-2:min(${height},ih)`,
				"-c:v", "libx264", "-preset", "veryfast",
				"-b:v", `${videoK}k`, "-maxrate", `${videoK}k`, "-bufsize", `${videoK * 2}k`,
				"-c:a", "aac", "-b:a", `${audio}k`, "-movflags", "+faststart", out,
			],
			4 * 60_000,
		);
		if (!r.ok) continue;
		const st = await stat(out).catch(() => null);
		if (st && st.size <= maxBytes) {
			await rm(path, { force: true });
			await rename(out, path);
			return;
		}
	}
	await rm(out, { force: true });
	throw new Error("não coube nem comprimido");
}

export class YtDlpDownloader implements MediaDownloader {
	private readonly bin: string;
	private readonly outbox: Outbox;

	constructor(bin: string, outbox: Outbox) {
		this.bin = bin;
		this.outbox = outbox;
	}

	async download(url: string, channelId: string): Promise<MediaResult> {
		const dir = this.outbox.dirFor(channelId);
		await mkdir(dir, { recursive: true });
		const started = Date.now();
		const r = await run(
			this.bin,
			["--no-playlist", "--merge-output-format", "mp4", "--max-filesize", String(MAX_BYTES), "-o", join(dir, "%(id)s.%(ext)s"), "--", url],
			5 * 60_000,
		);
		if (!r.ok) return { kind: "failed", output: r.out };
		const files: string[] = [];
		const dropped: string[] = [];
		for (const name of await readdir(dir)) {
			const path = join(dir, name);
			const st = await stat(path).catch(() => null);
			if (!st || st.isDirectory() || st.mtimeMs < started - 1000) continue;
			if (st.size <= MAX_BYTES) {
				files.push(`${name} (${st.size} bytes)`);
				continue;
			}
			try {
				await compressToFit(path, MAX_BYTES);
				files.push(`${name} (comprimido de ${mb(st.size)} MB p/ ${mb((await stat(path)).size)} MB)`);
			} catch (err) {
				await rm(path, { force: true });
				dropped.push(`${name} (${mb(st.size)} MB, não coube: ${err instanceof Error ? err.message : String(err)})`);
			}
		}
		return { kind: "done", files, dropped };
	}
}
