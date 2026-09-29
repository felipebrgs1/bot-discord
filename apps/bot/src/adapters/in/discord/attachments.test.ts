import { describe, expect, it } from "bun:test";
import { collectImageUrls, embedImageUrls, imagesOf, mergeUrls } from "./attachments.ts";

const img = (url: string, contentType?: string | null) => ({ url, contentType });

describe("collectImageUrls", () => {
	it("anexo de imagem por content-type ou extensao", () => {
		expect(collectImageUrls([img("https://cdn/a", "image/png")], [])).toEqual(["https://cdn/a"]);
		expect(collectImageUrls([img("https://cdn/foto.jpg")], [])).toEqual(["https://cdn/foto.jpg"]);
		expect(collectImageUrls([img("https://cdn/v.mp4", "video/mp4")], [])).toEqual([]);
		expect(collectImageUrls(undefined, undefined)).toEqual([]);
	});

	it("sticker de imagem entra, lottie nao", () => {
		expect(collectImageUrls([], [{ url: "https://cdn/sticker.png" }, { url: "https://cdn/anim.json" }])).toEqual([
			"https://cdn/sticker.png",
		]);
	});

	it("no maximo 3, anexos primeiro", () => {
		const atts = ["a", "b", "c", "d"].map((n) => img(`https://cdn/${n}.png`, "image/png"));
		expect(collectImageUrls(atts, [{ url: "https://cdn/s.png" }])).toEqual([
			"https://cdn/a.png",
			"https://cdn/b.png",
			"https://cdn/c.png",
		]);
	});
});

describe("embedImageUrls / imagesOf", () => {
	it("capas de embed sem repetir e sem json", () => {
		expect(
			embedImageUrls([{ thumbnail: { url: "https://t" }, image: { url: "https://i" } }, { image: { url: "https://i" } }, { image: { url: "x.json" } }]),
		).toEqual(["https://t", "https://i"]);
	});

	it("imagesOf junta anexos, stickers e embeds", () => {
		expect(
			imagesOf({
				attachments: new Map([["1", img("https://cdn/a.png", "image/png")]]),
				stickers: new Map([["s", { url: "https://cdn/s.png" }]]),
				embeds: [{ image: { url: "https://cdn/capa.jpg" } }],
			}),
		).toEqual(["https://cdn/a.png", "https://cdn/s.png", "https://cdn/capa.jpg"]);
	});
});

describe("mergeUrls", () => {
	it("junta sem repetir ate 3", () => {
		expect(mergeUrls(["a"], ["a", "b", "c", "d"])).toEqual(["a", "b", "c"]);
	});
});
