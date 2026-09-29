import { describe, expect, it } from "bun:test";
import { FakePageFetcher } from "../test-support/fakes/page-fetcher.ts";
import { DownloadImages } from "./download-images.ts";

describe("DownloadImages", () => {
	it("baixa e devolve base64 com o mime", async () => {
		const fetcher = new FakePageFetcher([[/a\.png/, { contentType: "image/png", bytes: new Uint8Array(10) }]]);
		expect(await new DownloadImages(fetcher).run(["https://cdn/a.png"])).toEqual([
			{ data: "AAAAAAAAAAAAAA==", mimeType: "image/png" },
		]);
	});

	it("descarta nao-imagem, vazia, gigante (>5MB), HTTP de erro e falha de rede", async () => {
		const fetcher = new FakePageFetcher([
			[/html/, { contentType: "text/html", body: "<p>" }],
			[/vazia/, { contentType: "image/png", bytes: new Uint8Array(0) }],
			[/big/, { contentType: "image/png", bytes: new Uint8Array((5 << 20) + 1) }],
			[/404/, { status: 404, contentType: "image/png", body: "x" }],
		]);
		const urls = ["https://x/html", "https://x/vazia", "https://x/big", "https://x/404", "https://x/boom"];
		expect(await new DownloadImages(fetcher).run(urls)).toEqual([]);
	});

	it("no maximo 3 imagens", async () => {
		const fetcher = new FakePageFetcher([[/./, { contentType: "image/png", body: "x" }]]);
		const urls = ["https://x/1", "https://x/2", "https://x/3", "https://x/4"];
		expect(await new DownloadImages(fetcher).run(urls)).toHaveLength(3);
		expect(fetcher.requested).toHaveLength(3);
	});
});
