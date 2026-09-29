import { describe, expect, it } from "bun:test";
import { LogBuffer } from "./log-buffer.ts";

const quiet = () => new LogBuffer(() => undefined);

describe("LogBuffer", () => {
	it("le so o que veio depois do cursor, com nivel", () => {
		const log = quiet();
		log.info("a");
		const { cursor } = log.after(0, 10);
		log.warn("b");
		log.error("c");
		const next = log.after(cursor, 10);
		expect(next.entries.map((e) => `${e.level} ${e.msg}`)).toEqual(["warn b", "error c"]);
		expect(next.cursor).toBe(3);
	});

	it("limite pega os mais recentes", () => {
		const log = quiet();
		for (const m of ["a", "b", "c"]) log.info(m);
		expect(log.after(0, 2).entries.map((e) => e.msg)).toEqual(["b", "c"]);
	});

	it("guarda no maximo 2000", () => {
		const log = quiet();
		for (let i = 0; i < 2010; i++) log.info(`m${i}`);
		const { entries } = log.after(0, 5000);
		expect(entries).toHaveLength(2000);
		expect(entries[0]?.msg).toBe("m10");
	});

	it("imprime cada linha com atributos em JSON", () => {
		const printed: string[] = [];
		const log = new LogBuffer((line, level) => void printed.push(`${level}:${line}`));
		log.log("error", "falhou", { canal: "c1" });
		expect(printed).toEqual(['error:falhou {"canal":"c1"}']);
	});
});
