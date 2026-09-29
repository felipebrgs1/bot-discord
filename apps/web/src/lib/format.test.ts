import { describe, expect, it } from "bun:test";
import { compact, latency, money, num, percent } from "./format.ts";

describe("format", () => {
	it("null vira travessao", () => {
		expect(num(null)).toBe("—");
		expect(latency(undefined)).toBe("—");
		expect(money(null)).toBe("—");
		expect(percent(null)).toBe("—");
	});

	it("latencia troca para segundos a partir de 1000 ms", () => {
		expect(latency(850)).toBe("850 ms");
		expect(latency(1500)).toBe("1,5 s");
	});

	it("numeros no formato pt-BR", () => {
		expect(num(12345)).toBe("12.345");
		expect(compact(15300)).toBe("15,3 mil");
		expect(percent(12.34)).toBe("12,3%");
		expect(money(0.01234)).toBe("US$ 0,0123");
	});
});
