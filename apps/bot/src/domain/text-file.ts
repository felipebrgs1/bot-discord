/** Anexo de texto (message.txt do Discord, .md, codigo): o que conta como texto e como entra no turno. */

/** Quantos arquivos de texto entram num turno. */
export const MAX_TEXT_FILES = 3;
/** Teto do download de cada arquivo. */
export const MAX_TEXT_FILE_BYTES = 512 << 10;
/** Teto de caracteres de cada arquivo no turno. */
export const MAX_TEXT_FILE_CHARS = 20_000;

const TEXT_EXTENSIONS = new Set([
	"txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "log", "yaml", "yml", "xml", "ini", "toml", "env",
	"html", "css", "js", "ts", "jsx", "tsx", "py", "go", "rs", "java", "kt", "c", "h", "cpp", "cs", "rb", "php",
	"lua", "sh", "sql", "srt", "vtt",
]);

export function isTextFile(name: string, contentType: string | null | undefined): boolean {
	if (contentType?.startsWith("text/")) return true;
	const dot = name.lastIndexOf(".");
	return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/** Arquivos com o nome antes do conteudo; longo e cortado com aviso. */
export function filesText(files: readonly { name: string; text: string }[]): string {
	return files
		.map((f) => {
			const body = f.text.trimEnd();
			const cut = body.length > MAX_TEXT_FILE_CHARS ? `${body.slice(0, MAX_TEXT_FILE_CHARS)}\n[... cortado]` : body;
			return `[arquivo ${f.name}]\n${cut}`;
		})
		.join("\n\n");
}
