import { describe, expect, it } from "bun:test";
import { APURACAO_COMMAND_JSON } from "./apuracao.ts";

describe("APURACAO_COMMAND_JSON", () => {
	it("tem o toggle como opcao opcional", () => {
		expect(APURACAO_COMMAND_JSON.name).toBe("apuracao");
		expect(APURACAO_COMMAND_JSON.options).toMatchObject([{ name: "ligado", required: false }]);
	});
});
