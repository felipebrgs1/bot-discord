/** Guarda SSRF: lanca se o host resolve para rede interna. */
export interface HostGuard {
	assertPublic(host: string): Promise<void>;
}
