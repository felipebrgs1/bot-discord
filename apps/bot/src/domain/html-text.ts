/** HTML para texto legivel (sem parser: regex, suficiente para materia e busca). */

export function unescapeHtml(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

/** Titulo + linhas com mais de `minLine` caracteres; script/style/noscript fora. */
export function htmlToText(page: string, minLine = 40): { title: string; text: string } {
	const rawTitle = /<title[^>]*>(.*?)<\/title>/is.exec(page)?.[1] ?? "";
	const title = unescapeHtml(rawTitle.replace(/<[^>]+>/g, "").trim());
	const stripped = unescapeHtml(
		page.replace(/<(script|style|noscript)[^>]*>.*?<\/\1>/gis, " ").replace(/<[^>]+>/g, " "),
	);
	const text = stripped
		.split("\n")
		.map((l) => l.replace(/[ \t ]+/g, " ").trim())
		.filter((l) => l.length > minLine)
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
	return { title, text };
}
