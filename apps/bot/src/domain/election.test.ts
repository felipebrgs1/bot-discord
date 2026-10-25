import { describe, expect, it } from "bun:test";
import { type AreaTally, isFinal, STATES, statesText, statesThreadName, summaryText } from "./election.ts";

const tally = (over: Partial<AreaTally> = {}): AreaTally => ({
	area: "br",
	updatedAt: "25/10/2026 19:30:12",
	sectionsPct: "87,32",
	candidates: [
		{ number: "22", name: "FLAVIO BOLSONARO", votes: 54_000_000, pct: "49,88", elected: false },
		{ number: "13", name: "LULA", votes: 55_123_456, pct: "50,12", elected: false },
	],
	blank: 1_234_567,
	nulls: 2_345_678,
	...over,
});

describe("summaryText", () => {
	it("total e exterior, candidatos do mais votado ao menos, votos com ponto de milhar", () => {
		const text = summaryText(tally(), tally({ area: "zz", sectionsPct: "95,00", blank: 10, nulls: 20 }));
		expect(text).toBe(
			[
				"**Apuração 2º turno: Presidente** (TSE, 25/10/2026 19:30:12)",
				"",
				"**Total (Brasil + exterior)**: 87,32% das seções apuradas",
				"1. LULA (13): 50,12% (55.123.456 votos)",
				"2. FLAVIO BOLSONARO (22): 49,88% (54.000.000 votos)",
				"Brancos: 1.234.567 · Nulos: 2.345.678",
				"",
				"**Exterior**: 95,00% das seções apuradas",
				"1. LULA (13): 50,12% (55.123.456 votos)",
				"2. FLAVIO BOLSONARO (22): 49,88% (54.000.000 votos)",
				"Brancos: 10 · Nulos: 20",
			].join("\n"),
		);
	});

	it("sem dados do exterior mostra so o total", () => {
		const text = summaryText(tally(), null);
		expect(text).not.toContain("Exterior");
		expect(text).toContain("**Total (Brasil + exterior)**");
	});

	it("marca o eleito", () => {
		const done = tally({ sectionsPct: "100,00" });
		const [flavio, lula] = done.candidates;
		const text = summaryText({ ...done, candidates: [{ ...flavio!, elected: false }, { ...lula!, elected: true }] }, null);
		expect(text).toContain("1. LULA (13): 50,12% (55.123.456 votos), ELEITO");
	});
});

describe("statesText", () => {
	it("uma linha por estado, na ordem dada, lider primeiro; estado sem dados avisa", () => {
		const text = statesText([
			{ uf: "AC", tally: tally({ area: "ac", sectionsPct: "100,00" }) },
			{ uf: "SP", tally: null },
		]);
		expect(text).toBe(["**AC** (100,00% apurado): LULA 50,12% · FLAVIO BOLSONARO 49,88%", "**SP**: sem dados ainda"].join("\n"));
	});
});

describe("statesThreadName", () => {
	it("leva data e hora do fuso dado", () => {
		expect(statesThreadName(Date.parse("2026-10-25T22:00:00.000Z"), "America/Sao_Paulo")).toBe("Apuração por estado: 25/10 19:00");
	});
});

describe("isFinal", () => {
	it("so com 100% das secoes", () => {
		expect(isFinal(tally({ sectionsPct: "99,99" }))).toBe(false);
		expect(isFinal(tally({ sectionsPct: "100,00" }))).toBe(true);
	});
});

describe("STATES", () => {
	it("27 unidades da federacao, sem o exterior", () => {
		expect(STATES).toHaveLength(27);
		expect(STATES).toContain("SP");
		expect(STATES).not.toContain("ZZ");
	});
});
