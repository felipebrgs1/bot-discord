import { describe, expect, it } from "bun:test";
import { MAX_IMAGE_BYTES } from "@/domain/image.ts";
import { FakeImageShrinker } from "@/test-support/fakes/image-shrinker.ts";
import { type FakeRoute, FakePageFetcher } from "@/test-support/fakes/page-fetcher.ts";
import { DownloadImages } from "./download-images.ts";

function setup(routes: [RegExp, FakeRoute][], shrinker = new FakeImageShrinker()) {
	return { images: new DownloadImages(new FakePageFetcher(routes), shrinker), shrinker };
}

describe("DownloadImages", () => {
	it("baixa e devolve base64 com o mime", async () => {
		const { images } = setup([[/a\.png/, { contentType: "image/png", bytes: new Uint8Array(10) }]]);
		expect(await images.run(["https://cdn/a.png"])).toEqual([{ data: "AAAAAAAAAAAAAA==", mimeType: "image/png" }]);
	});

	it("imagem de ate 3MB vai ao modelo sem comprimir", async () => {
		const { images, shrinker } = setup([[/mid/, { contentType: "image/png", bytes: new Uint8Array(2 << 20) }]]);
		expect(await images.run(["https://x/mid"])).toHaveLength(1);
		expect(shrinker.calls).toHaveLength(0);
	});

	it("imagem acima de 3MB e comprimida ate 3MB antes de ir ao modelo", async () => {
		const big = new Uint8Array((3 << 20) + 1);
		const { images, shrinker } = setup([[/big/, { contentType: "image/png", bytes: big }]]);
		expect(await images.run(["https://x/big"])).toEqual([{ data: "AAAAAAAAAAAAAA==", mimeType: "image/jpeg" }]);
		expect(shrinker.calls).toHaveLength(1);
		expect(shrinker.calls[0]?.maxBytes).toBe(MAX_IMAGE_BYTES);
		expect(shrinker.calls[0]?.image.mimeType).toBe("image/png");
	});

	it("descarta imagem grande que a compressao nao consegue levar a 3MB", async () => {
		const { images } = setup([[/big/, { contentType: "image/png", bytes: new Uint8Array((3 << 20) + 1) }]], new FakeImageShrinker(null));
		expect(await images.run(["https://x/big"])).toEqual([]);
	});

	it("nao tenta comprimir o que passa de 20MB bruto", async () => {
		const { images, shrinker } = setup([[/huge/, { contentType: "image/png", bytes: new Uint8Array((20 << 20) + 1) }]]);
		expect(await images.run(["https://x/huge"])).toEqual([]);
		expect(shrinker.calls).toHaveLength(0);
	});

	it("descarta nao-imagem, vazia, HTTP de erro e falha de rede", async () => {
		const { images } = setup([
			[/html/, { contentType: "text/html", body: "<p>" }],
			[/vazia/, { contentType: "image/png", bytes: new Uint8Array(0) }],
			[/404/, { status: 404, contentType: "image/png", body: "x" }],
		]);
		expect(await images.run(["https://x/html", "https://x/vazia", "https://x/404", "https://x/boom"])).toEqual([]);
	});

	it("no maximo 3 imagens", async () => {
		const fetcher = new FakePageFetcher([[/./, { contentType: "image/png", body: "x" }]]);
		const urls = ["https://x/1", "https://x/2", "https://x/3", "https://x/4"];
		expect(await new DownloadImages(fetcher, new FakeImageShrinker()).run(urls)).toHaveLength(3);
		expect(fetcher.requested).toHaveLength(3);
	});
});
