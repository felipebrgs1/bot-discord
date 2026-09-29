/** Visao: anexos/stickers do chat viram imagens para o modelo. Falha isolada so descarta aquela. */

import { type ImageData, MAX_IMAGE_BYTES, MAX_VISION_IMAGES } from "../domain/image.ts";
import type { PageFetcher } from "./ports/page-fetcher.ts";

export class DownloadImages {
	private readonly fetcher: PageFetcher;

	constructor(fetcher: PageFetcher) {
		this.fetcher = fetcher;
	}

	async run(urls: readonly string[]): Promise<ImageData[]> {
		const got = await Promise.all(urls.slice(0, MAX_VISION_IMAGES).map((u) => this.one(u)));
		return got.filter((g): g is ImageData => g !== null);
	}

	private async one(url: string): Promise<ImageData | null> {
		try {
			const page = await this.fetcher.binary(url, MAX_IMAGE_BYTES);
			const ok = page.status >= 200 && page.status < 300;
			if (!ok || !page.contentType.startsWith("image/") || !page.base64 || page.size === 0) return null;
			return { data: page.base64, mimeType: page.contentType };
		} catch {
			return null;
		}
	}
}
