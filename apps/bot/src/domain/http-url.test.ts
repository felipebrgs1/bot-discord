import { describe, expect, it } from "bun:test";
import { parseHttpUrl } from "./http-url.ts";

describe("parseHttpUrl", () => {
	it("aceita http e https com host", () => {
		expect(parseHttpUrl(" https://x.com/a ")?.host).toBe("x.com");
		expect(parseHttpUrl("http://x.com")?.protocol).toBe("http:");
	});

	it("recusa outro protocolo e lixo", () => {
		expect(parseHttpUrl("ftp://x/y")).toBeNull();
		expect(parseHttpUrl("não-url")).toBeNull();
		expect(parseHttpUrl("")).toBeNull();
	});
});
