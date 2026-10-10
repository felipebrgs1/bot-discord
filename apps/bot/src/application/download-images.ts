/** Visao: anexos/stickers do chat viram imagens para o modelo. Imagem grande e comprimida; falha isolada so descarta aquela. */

import { type ImageData, MAX_DOWNLOAD_BYTES, MAX_IMAGE_BYTES, MAX_VISION_IMAGES } from "../domain/image.ts";
import type { ImageShrinker } from "./ports/image-shrinker.ts";
import type { PageFetcher } from "./ports/page-fetcher.ts";

export class DownloadImages {
	private readonly fetcher: PageFetcher;
	private readonly shrinker: ImageShrinker;

	constructor(fetcher: PageFetcher, shrinker: ImageShrinker) {
		this.fetcher = fetcher;
		this.shrinker = shrinker;
	}

	async run(urls: readonly string[]): Promise<ImageData[]> {
		const got = await Promise.all(urls.slice(0, MAX_VISION_IMAGES).map((u) => this.one(u)));
		return got.filter((g): g is ImageData => g !== null);
	}

	private async one(url: string): Promise<ImageData | null> {
		try {
			const page = await this.fetcher.binary(url, MAX_DOWNLOAD_BYTES);
			const ok = page.status >= 200 && page.status < 300;
			if (!ok || !page.contentType.startsWith("image/") || !page.base64 || page.size === 0) return null;
			const image = { data: page.base64, mimeType: page.contentType };
			if (page.size <= MAX_IMAGE_BYTES) return image;
			return await this.shrinker.shrink(image, MAX_IMAGE_BYTES);
		} catch {
			return null;
		}
	}
}
