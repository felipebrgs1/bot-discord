/** URL http/https com host; qualquer outra coisa e null. */
export function parseHttpUrl(raw: string): URL | null {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host) return null;
	return url;
}
