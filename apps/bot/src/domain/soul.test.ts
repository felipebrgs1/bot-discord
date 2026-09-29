import { describe, expect, it } from "bun:test";
import { soulSlug } from "./soul.ts";

describe("soulSlug", () => {
	it("minusculo e so [a-z0-9_-]", () => {
		expect(soulSlug("Sério Demais!")).toBe("s-rio-demais-");
		expect(soulSlug("el_matador-2")).toBe("el_matador-2");
	});

	it("corta em 40", () => {
		expect(soulSlug("a".repeat(50))).toHaveLength(40);
	});

	it("vazio e invalido", () => {
		expect(() => soulSlug("")).toThrow("nome inválido");
	});
});
