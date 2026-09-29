import { describe, expect, it } from "bun:test";
import { pageFetcherContract } from "../../../application/ports/page-fetcher.contract.ts";
import { CONTRACT_ROUTES } from "../../../test-support/fakes/page-fetcher.ts";
import { BROWSER_UA, HttpPageFetcher } from "./http-fetcher.ts";

const openGuard = { assertPublic: async () => undefined };

/** fetch injetado que responde as rotas do contrato (sem rede). */
const routedHttp = (async (input: string | URL | Request) => {
	const url = String(input);
	for (const [re, r] of CONTRACT_ROUTES) {
		if (re.test(url)) {
			const body = r.bytes ?? r.body ?? "";
			return new Response(body, { status: r.status ?? 200, headers: { "content-type": `${r.contentType ?? "text/plain"}; charset=x` } });
		}
	}
	throw new Error(`rota não mockada: ${url}`);
}) as typeof fetch;

describe("HttpPageFetcher", () => {
	pageFetcherContract(() => new HttpPageFetcher({ guard: openGuard, http: routedHttp }));

	it("passa pela guarda antes de pedir e manda UA de navegador", async () => {
		const guarded: string[] = [];
		const headers: unknown[] = [];
		const fetcher = new HttpPageFetcher({
			guard: { assertPublic: async (h) => void guarded.push(h) },
			http: (async (_u: string | URL | Request, init?: RequestInit) => {
				headers.push(init?.headers);
				return new Response("x");
			}) as typeof fetch,
		});
		await fetcher.text("https://site.test:8443/a");
		expect(guarded).toEqual(["site.test:8443"]);
		expect(headers[0]).toMatchObject({ "User-Agent": BROWSER_UA });
	});

	it("guarda que recusa impede o pedido", async () => {
		let called = false;
		const fetcher = new HttpPageFetcher({
			guard: {
				assertPublic: async () => {
					throw new Error("destino interno bloqueado");
				},
			},
			http: (async () => {
				called = true;
				return new Response("x");
			}) as unknown as typeof fetch,
		});
		await expect(fetcher.text("http://localhost/")).rejects.toThrow("bloqueado");
		expect(called).toBe(false);
	});
});
