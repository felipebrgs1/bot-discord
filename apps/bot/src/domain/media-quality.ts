/**
 * Qualidade do video baixado: a maior resolucao cujo tamanho estimado cabe no
 * teto de anexo, nunca abaixo de 240p.
 */

export const MEDIA_MIN_HEIGHT = 240;

/** Formato oferecido pela plataforma (traduzido pelo adapter). */
export interface MediaFormat {
	id: string;
	height: number | null;
	hasVideo: boolean;
	hasAudio: boolean;
	bytes: number | null;
	tbrKbps: number | null;
}

function sizeOf(f: MediaFormat, durationSec: number): number | null {
	if (f.bytes !== null && f.bytes > 0) return f.bytes;
	if (f.tbrKbps !== null && f.tbrKbps > 0 && durationSec > 0) return (f.tbrKbps * 1000 * durationSec) / 8;
	return null;
}

/**
 * Seletor de formato (`video+audio` ou formato unico) ou null se nada de
 * tamanho conhecido cabe em `maxBytes` a partir de 240p.
 */
export function pickMediaFormat(formats: readonly MediaFormat[], durationSec: number, maxBytes: number): string | null {
	const sized = formats.flatMap((f) => {
		const bytes = sizeOf(f, durationSec);
		return bytes === null ? [] : [{ f, bytes }];
	});
	const audios = sized.filter(({ f }) => f.hasAudio && !f.hasVideo);
	const candidates: { id: string; height: number; bytes: number }[] = [];
	for (const { f, bytes } of sized) {
		if (!f.hasVideo || f.height === null || f.height < MEDIA_MIN_HEIGHT) continue;
		if (f.hasAudio || audios.length === 0) candidates.push({ id: f.id, height: f.height, bytes });
		else for (const a of audios) candidates.push({ id: `${f.id}+${a.f.id}`, height: f.height, bytes: bytes + a.bytes });
	}
	const best = candidates
		.filter((c) => c.bytes <= maxBytes)
		.sort((a, b) => b.height - a.height || b.bytes - a.bytes)[0];
	return best?.id ?? null;
}
