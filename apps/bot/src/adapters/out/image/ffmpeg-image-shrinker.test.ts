import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { imageShrinkerContract } from "../../../application/ports/image-shrinker.contract.ts";
import type { ImageData } from "../../../domain/image.ts";
import { FfmpegImageShrinker } from "./ffmpeg-image-shrinker.ts";

/** PNG grande e comprimivel (1,4 MB), gerada pelo proprio ffmpeg. */
function bigPng(): ImageData {
	const path = join(mkdtempSync(join(tmpdir(), "shrink-fixture-")), "foto.png");
	execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "mandelbrot=s=1600x1600", "-frames:v", "1", path]);
	return { data: readFileSync(path).toString("base64"), mimeType: "image/png" };
}

const fixture = bigPng();

describe("FfmpegImageShrinker", () => {
	imageShrinkerContract(() => new FfmpegImageShrinker(), fixture, 1 << 20);

	it("saida e JPEG", async () => {
		const out = await new FfmpegImageShrinker().shrink(fixture, 1 << 20);
		expect(out?.mimeType).toBe("image/jpeg");
		expect(Buffer.from(out?.data ?? "", "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
	});

	it("sem ffmpeg instalado devolve null, nao lanca", async () => {
		expect(await new FfmpegImageShrinker({ ffmpeg: "ffmpeg-que-nao-existe" }).shrink(fixture, 1 << 20)).toBeNull();
	});
});
