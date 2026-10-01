/**
 * MediaDownloader via yt-dlp para o outbox do canal. Sonda os formatos e baixa
 * a maior resolucao que cabe no teto (minimo 240p). Arquivo acima do teto e
 * recomprimido com ffmpeg (720p descendo ate 240p); se nao couber, descartado.
 */

import { execFile } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MediaDownloader, MediaResult } from "../../../application/ports/media-downloader.ts";
import type { Outbox } from "../../../application/ports/outbox.ts";
import { MEDIA_MIN_HEIGHT, type MediaFormat, pickMediaFormat } from "../../../domain/media-quality.ts";

const MAX_BYTES = 20 << 20;
/** Teto do download bruto no seletor de reserva (depois recomprime). */
const DOWNLOAD_CAP_BYTES = 200 << 20;
/** Tamanho desconhecido: ate 720p, que e onde a recompressao comeca. */
const FALLBACK_FORMAT = "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b";
const COMPRESS_LADDER = [
	[720, 96, 150],
	[480, 64, 120],
	[360, 48, 80],
	[MEDIA_MIN_HEIGHT, 32, 50],
] as const;
const mb = (bytes: number) => (bytes / 1048576).toFixed(1);

/** `out`: stdout + stderr (para erro); `stdout`: so a saida util. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; out: string; stdout: string }> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 64 << 20 }, (err, stdout, stderr) => {
			const out = `${stdout}${stderr}`.trim();
			resolve(err ? { ok: false, out: out || err.message, stdout } : { ok: true, out, stdout });
		});
	});
}

export interface FfmpegTools {
	ffmpeg: string;
	ffprobe: string;
}

const numberOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** JSON do `yt-dlp -J` -> formatos do dominio. */
function parseProbe(json: string): { durationSec: number; formats: MediaFormat[] } {
	const info = JSON.parse(json) as { duration?: unknown; formats?: unknown };
	const raw = Array.isArray(info.formats) ? (info.formats as Record<string, unknown>[]) : [];
	// Como no yt-dlp: so "none" e ausente; codec desconhecido conta como presente.
	const has = (codec: unknown) => codec !== "none";
	return {
		durationSec: numberOr(info.duration) ?? 0,
		formats: raw.map((f) => ({
			id: String(f["format_id"]),
			height: numberOr(f["height"]),
			hasVideo: has(f["vcodec"]),
			hasAudio: has(f["acodec"]),
			bytes: numberOr(f["filesize"]) ?? numberOr(f["filesize_approx"]),
			tbrKbps: numberOr(f["tbr"]),
		})),
	};
}

async function compressToFit(path: string, maxBytes: number, tools: FfmpegTools): Promise<void> {
	const probe = await run(tools.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path], 30_000);
	const duration = Number.parseFloat(probe.stdout.trim());
	if (!probe.ok || !Number.isFinite(duration) || duration <= 0) throw new Error("duração ilegível");
	const target = maxBytes * 0.92;
	const out = `${path}.fit.mp4`;
	for (const [height, audio, minVideoK] of COMPRESS_LADDER) {
		const videoK = Math.max(minVideoK, Math.floor((target * 8) / duration / 1000 - audio));
		await rm(out, { force: true });
		const r = await run(
			tools.ffmpeg,
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
	private readonly tools: FfmpegTools;

	constructor(bin: string, outbox: Outbox, tools: FfmpegTools = { ffmpeg: "ffmpeg", ffprobe: "ffprobe" }) {
		this.bin = bin;
		this.outbox = outbox;
		this.tools = tools;
	}

	/** Seletor -f: o melhor formato que cabe ou a reserva para recomprimir. */
	private async chooseFormat(url: string): Promise<{ ok: true; format: string } | { ok: false; out: string }> {
		const r = await run(this.bin, ["-J", "--no-playlist", "--", url], 60_000);
		if (!r.ok) return { ok: false, out: r.out };
		let probe: ReturnType<typeof parseProbe>;
		try {
			probe = parseProbe(r.stdout);
		} catch {
			return { ok: true, format: FALLBACK_FORMAT };
		}
		return { ok: true, format: pickMediaFormat(probe.formats, probe.durationSec, MAX_BYTES) ?? FALLBACK_FORMAT };
	}

	async download(url: string, channelId: string): Promise<MediaResult> {
		const dir = this.outbox.dirFor(channelId);
		await mkdir(dir, { recursive: true });
		const choice = await this.chooseFormat(url);
		if (!choice.ok) return { kind: "failed", output: choice.out };
		const started = Date.now();
		const r = await run(
			this.bin,
			[
				"--no-playlist", "-f", choice.format, "--merge-output-format", "mp4",
				"--max-filesize", String(DOWNLOAD_CAP_BYTES), "-o", join(dir, "%(id)s.%(ext)s"), "--", url,
			],
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
				await compressToFit(path, MAX_BYTES, this.tools);
				files.push(`${name} (comprimido de ${mb(st.size)} MB p/ ${mb((await stat(path)).size)} MB)`);
			} catch (err) {
				await rm(path, { force: true });
				dropped.push(`${name} (${mb(st.size)} MB, não coube: ${err instanceof Error ? err.message : String(err)})`);
			}
		}
		return { kind: "done", files, dropped };
	}
}
