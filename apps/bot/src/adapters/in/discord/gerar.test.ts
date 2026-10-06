import { describe, expect, it } from "bun:test";
import { GERAR_COMMAND_JSON } from "./gerar.ts";

describe("GERAR_COMMAND_JSON", () => {
	it("pede a descricao da imagem como opcao obrigatoria", () => {
		expect(GERAR_COMMAND_JSON.name).toBe("gerar");
		expect(GERAR_COMMAND_JSON.options).toMatchObject([{ name: "prompt", required: true }]);
	});
});
