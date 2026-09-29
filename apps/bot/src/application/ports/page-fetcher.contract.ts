import { expect, it } from "bun:test";
import type { PageFetcher } from "./page-fetcher.ts";

/**
 * O fabricante recebe as rotas que a "internet" do teste responde:
 * https://site.test/ok -> 200 "<p>ok</p>"; /json -> 200 {"a":1};
 * /404 -> 404; /img -> 200 image/png com 10 bytes zero.
 */
export function pageFetcherContract(make: () => PageFetcher): void {
	it("text devolve status e corpo", async () => {
		expect(await make().text("https://site.test/ok")).toEqual({ status: 200, text: "<p>ok</p>" });
		expect((await make().text("https://site.test/404")).status).toBe(404);
	});

	it("text corta em maxBytes", async () => {
		expect((await make().text("https://site.test/ok", 3)).text).toBe("<p>");
	});

	it("json parseia e lanca fora de 2xx", async () => {
		expect(await make().json("https://site.test/json")).toEqual({ a: 1 });
		await expect(make().json("https://site.test/404")).rejects.toThrow("HTTP 404");
	});

	it("binary devolve tipo, tamanho e base64; acima do teto, sem corpo", async () => {
		expect(await make().binary("https://site.test/img", 100)).toEqual({
			status: 200,
			contentType: "image/png",
			base64: "AAAAAAAAAAAAAA==",
			size: 10,
		});
		expect((await make().binary("https://site.test/img", 5)).base64).toBeNull();
	});
}
