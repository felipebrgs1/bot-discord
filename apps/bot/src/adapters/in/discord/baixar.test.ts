import { describe, expect, it } from "bun:test";
import { BAIXAR_COMMAND_JSON } from "./baixar.ts";

describe("BAIXAR_COMMAND_JSON", () => {
	it("pede a URL do video como opcao obrigatoria", () => {
		expect(BAIXAR_COMMAND_JSON.name).toBe("baixar");
		expect(BAIXAR_COMMAND_JSON.options).toMatchObject([{ name: "url", required: true }]);
	});
});
