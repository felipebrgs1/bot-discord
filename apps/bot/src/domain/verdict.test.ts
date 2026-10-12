import { describe, expect, it } from "bun:test";
import { formatVerdict, parseMultipleChoice, parseOptions } from "./verdict.ts";

describe("parseOptions", () => {
	it("apara, descarta vazias e repetidas (sem diferenciar maiusculas)", () => {
		expect(parseOptions([" Paprika ", "", "inception", "paprika", "Inception "])).toEqual(["Paprika", "inception"]);
	});

	it("exige de 2 a 10 opcoes", () => {
		expect(parseOptions(["so uma", " so uma "])).toBe("informe pelo menos 2 opções diferentes");
		expect(parseOptions(Array.from({ length: 11 }, (_, n) => `o${n}`))).toBe("no máximo 10 opções");
	});
});

describe("formatVerdict", () => {
	it("escolha: vencedora, confianca e barras em ordem de probabilidade", () => {
		const text = formatVerdict({
			kind: "choice",
			pick: "Paprika",
			confidence: 0.61,
			probabilities: [
				{ option: "Inception", p: 0.28 },
				{ option: "Paprika", p: 0.72 },
			],
		});
		expect(text).toBe(
			["veredito: Paprika (confiança 61%)", "```", "Paprika   ███████░░░ 72%", "Inception ███░░░░░░░ 28%", "```"].join("\n"),
		);
	});

	it("sim ou nao: rotulo pela faixa da probabilidade", () => {
		expect(formatVerdict({ kind: "odds", p: 0.82 })).toBe(["veredito: sim (82%)", "```", "████████░░ 82%", "```"].join("\n"));
		expect(formatVerdict({ kind: "odds", p: 0.2 }).split("\n")[0]).toBe("veredito: não (20%)");
		expect(formatVerdict({ kind: "odds", p: 0.5 }).split("\n")[0]).toBe("veredito: dividido (50%)");
	});
});

describe("parseMultipleChoice", () => {
	it("separa o enunciado das alternativas rotuladas A), B)...", () => {
		const text = [
			"@bot",
			"Todos os Nérglis são Vroblis. Qual conclusão decorre?",
			"",
			"A) Todos os Zéglis são Vroblis.",
			"B) Nenhum Tróvi é Nérgli,",
			"pois nenhum Vrobli é Tróvi.",
			"C) Alguns Drévis são Vroblis.",
		].join("\n");
		expect(parseMultipleChoice(text)).toEqual({
			question: "@bot\nTodos os Nérglis são Vroblis. Qual conclusão decorre?",
			options: [
				{ label: "A", text: "Todos os Zéglis são Vroblis." },
				{ label: "B", text: "Nenhum Tróvi é Nérgli,\npois nenhum Vrobli é Tróvi." },
				{ label: "C", text: "Alguns Drévis são Vroblis." },
			],
		});
	});

	it("aceita a. b. e (a) (b), em minuscula", () => {
		expect(parseMultipleChoice("qual?\na. sim\nb. nao")?.options.map((o) => o.label)).toEqual(["A", "B"]);
		expect(parseMultipleChoice("qual?\n(a) sim\n(b) nao")?.options.map((o) => o.label)).toEqual(["A", "B"]);
	});

	it("sem enunciado, com uma alternativa so ou fora de ordem nao e multipla escolha", () => {
		expect(parseMultipleChoice("A) sim\nB) nao")).toBeNull();
		expect(parseMultipleChoice("qual?\nA) sim")).toBeNull();
		expect(parseMultipleChoice("qual?\nB) sim\nC) nao")).toBeNull();
		expect(parseMultipleChoice("bora jogar hoje?")).toBeNull();
	});
});
