/**
 * Termos de busca a partir de texto livre (pergunta do modelo ou do usuario):
 * sem acento, sem palavras vazias do PT, plural simples cortado. Quem busca
 * casa por prefixo e aceita qualquer termo (mais termos = mais relevante).
 */

const STOPWORDS = new Set(
	[
		"que", "qual", "quais", "quem", "onde", "quando", "como", "porque", "por", "pra", "pro", "para",
		"com", "sem", "uma", "uns", "umas", "dos", "das", "nos", "nas", "num", "numa", "pelo", "pela",
		"isso", "isto", "esse", "essa", "este", "esta", "aquele", "aquela", "ele", "ela", "eles", "elas",
		"meu", "minha", "seu", "sua", "nosso", "nossa", "voce", "vcs", "mais", "mas", "muito", "sobre",
		"foi", "era", "tem", "ter", "ser", "sao", "estao", "the", "and", "lembra",
	],
);

export function searchTerms(text: string): string[] {
	const terms = text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[^\p{L}\p{N}]+/u)
		.filter((t) => (t.length >= 3 || /^\p{N}+$/u.test(t)) && !STOPWORDS.has(t))
		.map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
		.filter((t) => !STOPWORDS.has(t));
	return [...new Set(terms)];
}
