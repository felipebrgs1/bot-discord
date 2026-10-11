/**
 * ImageShrinker com ffmpeg: JPEG, do maior para o menor (lado e qualidade)
 * ate caber. Primeiro quadro so (GIF animado vira imagem fixa).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ImageShrinker } from "@/application/ports/image-shrinker.ts";
import type { ImageData } from "@/domain/image.ts";

/** [lado maximo em px, qualidade mjpeg (2 melhor, 31 pior)], do mais nitido ao mais magro. */
const LADDER: readonly (readonly [number, number])[] = [
	[1600, 4],
	[1280, 6],
	[1024, 9],
	[800, 12],
	[640, 16],
	[480, 20],
];

export interface FfmpegImageShrinkerOptions {
	ffmpeg?: string;
	timeoutMs?: number;
}

function ffmpeg(bin: string, args: string[], timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(bin, args, { timeout: timeoutMs }, (err) => resolve(!err));
	});
}

export class FfmpegImageShrinker implements ImageShrinker {
	private readonly bin: string;
	private readonly timeoutMs: number;

	constructor(opts: FfmpegImageShrinkerOptions = {}) {
		this.bin = opts.ffmpeg ?? "ffmpeg";
		this.timeoutMs = opts.timeoutMs ?? 30_000;
	}

	async shrink(image: ImageData, maxBytes: number): Promise<ImageData | null> {
		if (Buffer.byteLength(image.data, "base64") <= maxBytes) return image;
		const dir = await mkdtemp(join(tmpdir(), "shrink-"));
		try {
			const input = join(dir, "in");
			await writeFile(input, Buffer.from(image.data, "base64"));
			for (const [side, quality] of LADDER) {
				const output = join(dir, `out-${side}-${quality}.jpg`);
				const scale = `scale='min(${side},iw)':'min(${side},ih)':force_original_aspect_ratio=decrease`;
				const args = ["-loglevel", "error", "-y", "-i", input, "-frames:v", "1", "-vf", scale, "-q:v", String(quality), output];
				if (!(await ffmpeg(this.bin, args, this.timeoutMs))) return null;
				const bytes = await readFile(output);
				if (bytes.byteLength <= maxBytes) return { data: bytes.toString("base64"), mimeType: "image/jpeg" };
			}
			return null;
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	}
}
