import type { ImageData } from "../../domain/image.ts";

/** Comprime uma imagem ate caber em `maxBytes` (bytes decodificados). Null se nao couber nem comprimida. */
export interface ImageShrinker {
	shrink(image: ImageData, maxBytes: number): Promise<ImageData | null>;
}
