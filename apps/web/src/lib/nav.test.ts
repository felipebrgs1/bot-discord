import { describe, expect, it } from "bun:test";
import { hashFor, viewFromHash } from "./nav.ts";

describe("nav", () => {
	it("hash exato vira view; o resto cai na conversa", () => {
		expect(viewFromHash("#/logs")).toBe("logs");
		expect(viewFromHash("#logs")).toBe("logs");
		expect(viewFromHash("#/logsx")).toBe("chat");
		expect(viewFromHash("")).toBe("chat");
	});

	it("hashFor e o inverso", () => {
		expect(viewFromHash(hashFor("metrics"))).toBe("metrics");
	});
});
