/** Imagem ja baixada, pronta para o modelo (base64). */
export interface ImageData {
	data: string;
	mimeType: string;
}

/** Quantas imagens entram numa resposta. */
export const MAX_VISION_IMAGES = 3;
/** Teto por imagem. */
export const MAX_IMAGE_BYTES = 5 << 20;
