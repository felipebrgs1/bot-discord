/** IDs do Discord digitados a mao: um por linha, virgula ou espaco. */
export function parseIds(text: string): string[] {
	return [...new Set(text.split(/[\s,]+/).filter(Boolean))];
}

export const formatIds = (ids: readonly string[]): string => ids.join("\n");

/** Id de sessao do chat web; o servidor aceita [A-Za-z0-9_-]{1,64}. */
export function newSessionId(fill: (bytes: Uint8Array) => Uint8Array): string {
	const bytes = fill(new Uint8Array(8));
	return `s${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
