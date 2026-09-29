/**
 * Soul: a mente do bot (system prompt extra), trocavel por canal.
 * Canal sem escolha usa a soul padrao.
 */

export const DEFAULT_SOUL = "elmatadore";

export interface Soul {
	name: string;
	body: string;
}

/** Nome de soul normalizado: minusculo, [a-z0-9_-], ate 40. */
export function soulSlug(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.slice(0, 40);
	if (!slug) throw new Error("nome inválido");
	return slug;
}
