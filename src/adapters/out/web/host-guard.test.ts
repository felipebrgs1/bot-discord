import { describe, expect, it } from "bun:test";
import { DnsHostGuard, isPrivateIp } from "./host-guard.ts";

const resolvingTo = (...ips: string[]) => new DnsHostGuard({ resolve: async () => ips });

describe("DnsHostGuard", () => {
	it("bloqueia localhost, metadata e .internal sem DNS", async () => {
		const guard = new DnsHostGuard({
			resolve: async () => {
				throw new Error("nao deveria resolver");
			},
		});
		for (const h of ["localhost", "metadata.google.internal", "x.internal", "LOCALHOST:8080"]) {
			await expect(guard.assertPublic(h)).rejects.toThrow("bloqueado");
		}
	});

	it("bloqueia host que resolve para IP interno", async () => {
		await expect(resolvingTo("93.184.216.34", "10.0.0.5").assertPublic("x.com")).rejects.toThrow("bloqueado");
	});

	it("libera host publico", async () => {
		await expect(resolvingTo("93.184.216.34").assertPublic("exemplo.com")).resolves.toBeUndefined();
	});

	it("DNS que falha vira erro com o host", async () => {
		const guard = new DnsHostGuard({
			resolve: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		await expect(guard.assertPublic("nao.existe")).rejects.toThrow("DNS falhou para nao.existe");
	});

	it("allowPrivate libera tudo", async () => {
		await expect(new DnsHostGuard({ allowPrivate: true }).assertPublic("localhost")).resolves.toBeUndefined();
	});
});

describe("isPrivateIp", () => {
	it("faixas privadas, loopback e link-local", () => {
		for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.9.9", "192.168.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "lixo"]) {
			expect(isPrivateIp(ip)).toBe(true);
		}
		for (const ip of ["8.8.8.8", "172.32.0.1", "2001:4860::8888"]) {
			expect(isPrivateIp(ip)).toBe(false);
		}
	});
});
