import { afterEach, describe, expect, it, vi } from "vitest";
import { collectImageUrls, downloadImages, MAX_VISION_IMAGES } from "./vision.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

const img = (url: string, contentType?: string | null) => ({ url, contentType });

describe("collectImageUrls", () => {
	it("pega anexo de imagem por content-type ou extensão", () => {
		expect(collectImageUrls([img("https://cdn/a", "image/png")], [])).toEqual(["https://cdn/a"]);
		expect(collectImageUrls([img("https://cdn/foto.jpg")], [])).toEqual(["https://cdn/foto.jpg"]);
		expect(collectImageUrls([img("https://cdn/v.mp4", "video/mp4")], [])).toEqual([]);
		expect(collectImageUrls([], [])).toEqual([]);
	});

	it("pega sticker de imagem, pula lottie", () => {
		expect(collectImageUrls([], [{ url: "https://cdn/sticker.png" }, { url: "https://cdn/anim.json" }])).toEqual([
			"https://cdn/sticker.png",
		]);
	});

	it("limita a 3 (anexos primeiro)", () => {
		const atts = ["a", "b", "c", "d"].map((n) => img(`https://cdn/${n}.png`, "image/png"));
		expect(collectImageUrls(atts, [{ url: "https://cdn/s.png" }])).toHaveLength(MAX_VISION_IMAGES);
	});
});

describe("downloadImages", () => {
	const stub = (mime: string, bytes: number, ok = true) =>
		vi.fn(async () => ({
			ok,
			status: ok ? 200 : 404,
			headers: { get: (h: string) => (h === "content-type" ? mime : null) },
			arrayBuffer: async () => new Uint8Array(bytes).buffer as ArrayBuffer,
		}));

	it("baixa e vira base64 com mime", async () => {
		vi.stubGlobal("fetch", stub("image/png", 10));
		const [got] = await downloadImages(["https://cdn/a.png"]);
		expect(got?.mimeType).toBe("image/png");
		expect(got?.data).toBe(Buffer.from(new Uint8Array(10)).toString("base64"));
	});

	it("descarta não-imagem, gigante e erro", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: unknown) => {
				const u = String(url);
				if (u.includes("html"))
					return {
						ok: true,
						status: 200,
						headers: { get: () => "text/html" },
						arrayBuffer: async () => new Uint8Array(5).buffer,
					};
				if (u.includes("big"))
					return {
						ok: true,
						status: 200,
						headers: { get: () => "image/png" },
						arrayBuffer: async () => new Uint8Array(6 << 20).buffer,
					};
				throw new Error("rede caiu");
			}),
		);
		expect(await downloadImages(["https://x/html", "https://x/big", "https://x/boom"])).toEqual([]);
	});
});
