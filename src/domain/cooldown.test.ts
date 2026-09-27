import { describe, expect, it } from "bun:test";
import { cooldownRemaining } from "./cooldown.ts";

describe("cooldownRemaining", () => {
	it("canal que nunca respondeu nao espera", () => {
		expect(cooldownRemaining(1_000, undefined, 4_000)).toBe(0);
	});

	it("espera o que falta do cooldown desde a ultima resposta", () => {
		expect(cooldownRemaining(11_000, 10_000, 4_000)).toBe(3_000);
	});

	it("cooldown vencido nao espera", () => {
		expect(cooldownRemaining(14_000, 10_000, 4_000)).toBe(0);
		expect(cooldownRemaining(20_000, 10_000, 4_000)).toBe(0);
	});

	it("cooldown zero nunca espera", () => {
		expect(cooldownRemaining(10_000, 10_000, 0)).toBe(0);
	});
});
