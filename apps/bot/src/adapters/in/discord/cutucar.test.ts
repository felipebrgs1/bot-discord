import { describe, expect, it } from "bun:test";
import { CUTUCAR_COMMAND_JSON } from "./cutucar.ts";

describe("CUTUCAR_COMMAND_JSON", () => {
	it("tem toggle e tempo como opcoes opcionais, tempo limitado a 5-1440 min", () => {
		expect(CUTUCAR_COMMAND_JSON.name).toBe("cutucar");
		expect(CUTUCAR_COMMAND_JSON.options).toMatchObject([
			{ name: "ligado", required: false },
			{ name: "minutos", required: false, min_value: 5, max_value: 1440 },
		]);
	});
});
