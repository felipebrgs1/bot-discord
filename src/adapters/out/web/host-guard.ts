/** Guarda SSRF (igual ao bot Go): bloqueia metadata de cloud e rede local. */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { HostGuard } from "../../../application/ports/host-guard.ts";

export function isPrivateIp(ip: string): boolean {
	if (!isIP(ip)) return true;
	if (ip.includes(":")) {
		const l = ip.toLowerCase();
		return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
	}
	const [a, b] = ip.split(".").map(Number);
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 169 && b === 254) return true;
	if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
	return a === 192 && b === 168;
}

export interface DnsHostGuardOptions {
	/** Libera tudo (testes locais). */
	allowPrivate?: boolean;
	resolve?: (host: string) => Promise<string[]>;
}

const dnsResolve = async (host: string): Promise<string[]> =>
	(await lookup(host, { all: true })).map((a) => a.address);

export class DnsHostGuard implements HostGuard {
	private readonly allowPrivate: boolean;
	private readonly resolve: (host: string) => Promise<string[]>;

	constructor(opts: DnsHostGuardOptions = {}) {
		this.allowPrivate = opts.allowPrivate ?? false;
		this.resolve = opts.resolve ?? dnsResolve;
	}

	async assertPublic(host: string): Promise<void> {
		if (this.allowPrivate) return;
		const h = host.toLowerCase().split(":")[0] ?? "";
		if (h === "localhost" || h === "metadata.google.internal" || h.endsWith(".internal")) {
			throw new Error("destino interno bloqueado");
		}
		let addresses: string[];
		try {
			addresses = await this.resolve(h);
		} catch {
			throw new Error(`DNS falhou para ${host}`);
		}
		if (addresses.some(isPrivateIp)) throw new Error("destino interno bloqueado");
	}
}
