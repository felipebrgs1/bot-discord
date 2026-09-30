import type { ImageData } from "../../domain/image.ts";

/** Gera imagem a partir de texto. Lanca com mensagem legivel em qualquer falha. */
export interface ImageGenerator {
	generate(prompt: string): Promise<ImageData>;
}
