/** Onde o Discord guarda imagem: anexos, stickers e capas de embed (propria, respondida, historico). */

import { MAX_VISION_IMAGES } from "../../../domain/image.ts";

export interface AttachmentLike {
	contentType?: string | null;
	url: string;
}

export interface ImageCarrier {
	id?: string;
	attachments?: { values(): Iterable<AttachmentLike> };
	stickers?: { values(): Iterable<{ url: string }> };
	embeds?: { thumbnail?: { url?: string } | null; image?: { url?: string } | null }[];
}

/** Itera Collection/Map (ou nada, quando ausente). */
export function valuesOf<T>(c: { values(): Iterable<T> } | undefined): Iterable<T> | undefined {
	try {
		return c?.values();
	} catch {
		return undefined;
	}
}

function looksLikeImage(a: AttachmentLike): boolean {
	if (a.contentType?.startsWith("image/")) return true;
	return /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(a.url);
}

/** URLs de imagem dos anexos + stickers (lottie/.json fica de fora), ate 3. */
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

/** Capas de embeds (ex.: resultado do /lista). */
export function embedImageUrls(embeds: ImageCarrier["embeds"]): string[] {
	const out: string[] = [];
	for (const e of embeds ?? []) {
		for (const url of [e.thumbnail?.url, e.image?.url]) {
			if (url && !url.endsWith(".json") && !out.includes(url)) out.push(url);
		}
	}
	return out;
}

/** Tudo que uma mensagem carrega de imagem. */
export function imagesOf(m: ImageCarrier): string[] {
	const out = collectImageUrls(valuesOf(m.attachments), valuesOf(m.stickers));
	for (const u of embedImageUrls(m.embeds)) if (!out.includes(u)) out.push(u);
	return out;
}

/** Junta sem repetir, ate o teto de imagens. */
export function mergeUrls(into: string[], more: readonly string[]): string[] {
	for (const u of more) {
		if (into.length >= MAX_VISION_IMAGES) break;
		if (!into.includes(u)) into.push(u);
	}
	return into;
}
