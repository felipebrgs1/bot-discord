import { describe, expect, it } from "bun:test";
import { canUseHostTools, roleOf } from "./roles.ts";

describe("roleOf", () => {
	it("quem esta em adminIds e admin", () => {
		expect(roleOf("a", ["a", "b"])).toBe("admin");
		expect(roleOf("b", ["a", "b"])).toBe("admin");
	});

	it("qualquer outro e user", () => {
		expect(roleOf("x", ["a"])).toBe("user");
		expect(roleOf("x", [])).toBe("user");
	});

	it("id vazio nunca e admin, mesmo se adminIds tiver vazio", () => {
		expect(roleOf("", [""])).toBe("user");
	});
});

describe("canUseHostTools", () => {
	it("so admin usa shell e arquivos da maquina do bot", () => {
		expect(canUseHostTools("admin")).toBe(true);
		expect(canUseHostTools("user")).toBe(false);
	});
});
