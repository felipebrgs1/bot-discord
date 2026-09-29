import { describe, expect, it } from "bun:test";
import type { LogEntry } from "@elmatadore/api";
import { appendLogs, filterLogs, formatAttr } from "./logs.ts";

const e = (id: number, level: LogEntry["level"], msg: string, attrs?: Record<string, unknown>): LogEntry => ({
	id,
	time: "2026-09-29T12:00:00.000Z",
	level,
	msg,
	attrs,
});

describe("filterLogs", () => {
	const entries = [e(1, "info", "resposta ok"), e(2, "warn", "lento", { canal: "c9" }), e(3, "error", "caiu")];

	it("filtra pelo nivel que o servidor manda (minusculo)", () => {
		expect(filterLogs(entries, { level: "warn", query: "" }).map((x) => x.id)).toEqual([2]);
	});

	it("all mostra tudo; texto busca na mensagem e nos atributos", () => {
		expect(filterLogs(entries, { level: "all", query: "" })).toHaveLength(3);
		expect(filterLogs(entries, { level: "all", query: "C9" }).map((x) => x.id)).toEqual([2]);
		expect(filterLogs(entries, { level: "all", query: "caiu" }).map((x) => x.id)).toEqual([3]);
	});
});

describe("appendLogs", () => {
	it("mantem so as ultimas N entradas", () => {
		const out = appendLogs([e(1, "info", "a"), e(2, "info", "b")], [e(3, "info", "c")], 2);
		expect(out.map((x) => x.id)).toEqual([2, 3]);
	});
});

describe("formatAttr", () => {
	it("encurta decimal e serializa objeto", () => {
		expect(formatAttr(12.345678)).toBe("12.3");
		expect(formatAttr(3)).toBe("3");
		expect(formatAttr({ a: 1 })).toBe('{"a":1}');
	});
});
