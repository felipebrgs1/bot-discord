export interface BinaryPage {
	status: number;
	/** Sem parametros, ex.: "image/png". */
	contentType: string;
	/** null quando passou de maxBytes. */
	base64: string | null;
	size: number;
}

/**
 * HTTP de saida (UA de navegador, timeout, guarda SSRF: destino interno
 * lanca "destino interno bloqueado").
 */
export interface PageFetcher {
	text(url: string, maxBytes?: number): Promise<{ status: number; text: string }>;
	/** Lanca "HTTP <status>" fora de 2xx. */
	json(url: string): Promise<unknown>;
	binary(url: string, maxBytes: number): Promise<BinaryPage>;
}
