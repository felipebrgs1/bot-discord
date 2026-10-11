import type { ImageShrinker } from "@/application/ports/image-shrinker.ts";
import type { ImageData } from "@/domain/image.ts";

/** Imagem "comprimida" padrao: 10 bytes em JPEG. Sem `shrunk`, nada e comprimivel. */
export const SHRUNK_JPEG: ImageData = { data: "AAAAAAAAAAAAAA==", mimeType: "image/jpeg" };

/** Se ja cabe, devolve igual; senao devolve `shrunk` quando ele cabe no maximo. */
export class FakeImageShrinker implements ImageShrinker {
	readonly calls: { image: ImageData; maxBytes: number }[] = [];
	private readonly shrunk: ImageData | null;

	constructor(shrunk: ImageData | null = SHRUNK_JPEG) {
		this.shrunk = shrunk;
	}

	async shrink(image: ImageData, maxBytes: number): Promise<ImageData | null> {
		this.calls.push({ image, maxBytes });
		if (Buffer.byteLength(image.data, "base64") <= maxBytes) return image;
		if (!this.shrunk || Buffer.byteLength(this.shrunk.data, "base64") > maxBytes) return null;
		return this.shrunk;
	}
}
