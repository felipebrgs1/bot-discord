/**
 * Visão: anexos de imagem e stickers do Discord viram ImageContent p/ o LLM.
 * Sem isso o bot recebe só o texto e responde "só o vazio" p/ foto/sticker.
 */

export interface VisionImage {
	data: string; // base64
	mimeType: string; // ex.: image/png
}

export const MAX_VISION_IMAGES = 3;
const MAX_IMAGE_BYTES = 5 << 20;

interface AttachmentLike {
	contentType?: string | null;
	url: string;
}

function looksLikeImage(a: AttachmentLike): boolean {
	if (a.contentType?.startsWith("image/")) return true;
	return /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(a.url);
}

/** URLs de imagem dos anexos + stickers (lottie/.json fica de fora). */
export function collectImageUrls(
	attachments: Iterable<AttachmentLike> | undefined,
	stickers: Iterable<{ url: string }> | undefined,
): string[] {
	const out: string[] = [];
	for (const a of attachments ?? []) {
		if (out.length >= MAX_VISION_IMAGES) break;
		if (a.url && looksLikeImage(a)) out.push(a.url);
	}
	for (const s of stickers ?? []) {
		if (out.length >= MAX_VISION_IMAGES) break;
		if (s.url && !s.url.endsWith(".json")) out.push(s.url);
	}
	return out;
}

async function downloadOne(url: string): Promise<VisionImage | null> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
		if (!res.ok || !mime.startsWith("image/")) return null;
		const buf = await res.arrayBuffer();
		if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null;
		return { data: Buffer.from(buf).toString("base64"), mimeType: mime };
	} catch {
		/* anexo individual nunca quebra a resposta */
		return null;
	}
}

/** Baixa em paralelo; falha isolada só descarta aquele anexo. */
export async function downloadImages(urls: string[]): Promise<VisionImage[]> {
	const got = await Promise.all(urls.slice(0, MAX_VISION_IMAGES).map((u) => downloadOne(u)));
	return got.filter((g): g is VisionImage => g !== null);
}
