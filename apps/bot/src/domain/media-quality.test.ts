import { describe, expect, it } from "bun:test";
import { MEDIA_MIN_HEIGHT, type MediaFormat, pickMediaFormat } from "./media-quality.ts";

const MB = 1 << 20;
const video = (id: string, height: number, bytes: number | null, tbrKbps: number | null = null): MediaFormat => ({
	id,
	height,
	hasVideo: true,
	hasAudio: false,
	bytes,
	tbrKbps,
});
const audio = (id: string, bytes: number): MediaFormat => ({ id, height: null, hasVideo: false, hasAudio: true, bytes, tbrKbps: null });
const muxed = (id: string, height: number, bytes: number | null): MediaFormat => ({ ...video(id, height, bytes), hasAudio: true });

describe("pickMediaFormat", () => {
	it("escolhe a maior resolucao que cabe no teto, com audio", () => {
		const formats = [video("1080", 1080, 40 * MB), video("720", 720, 15 * MB), video("480", 480, 8 * MB), audio("a", 2 * MB)];
		expect(pickMediaFormat(formats, 60, 20 * MB)).toBe("720+a");
	});

	it("conta o audio no total", () => {
		const formats = [video("720", 720, 19 * MB), video("480", 480, 9 * MB), audio("a", 2 * MB)];
		expect(pickMediaFormat(formats, 60, 20 * MB)).toBe("480+a");
	});

	it("aceita formato ja com audio sem somar outro", () => {
		expect(pickMediaFormat([muxed("m720", 720, 19 * MB), audio("a", 2 * MB)], 60, 20 * MB)).toBe("m720");
	});

	it("na mesma resolucao prefere o maior arquivo que cabe", () => {
		const formats = [video("h264", 720, 10 * MB), video("vp9", 720, 14 * MB), video("av1", 720, 25 * MB), audio("a", 1 * MB)];
		expect(pickMediaFormat(formats, 60, 20 * MB)).toBe("vp9+a");
	});

	it("estima o tamanho pelo bitrate quando falta o tamanho", () => {
		// 2000 kbps * 60 s = 15 MB; 4000 kbps * 60 s = 30 MB.
		const formats = [video("hi", 1080, null, 4000), video("lo", 720, null, 2000), audio("a", 1 * MB)];
		expect(pickMediaFormat(formats, 60, 20 * MB)).toBe("lo+a");
	});

	it(`nunca escolhe abaixo de ${MEDIA_MIN_HEIGHT}p`, () => {
		const formats = [video("360", 360, 30 * MB), video("144", 144, 1 * MB), audio("a", 1 * MB)];
		expect(pickMediaFormat(formats, 60, 20 * MB)).toBeNull();
	});

	it("sem tamanho nem bitrate nao arrisca", () => {
		expect(pickMediaFormat([muxed("m", 720, null), video("v", 480, null)], 0, 20 * MB)).toBeNull();
	});
});
