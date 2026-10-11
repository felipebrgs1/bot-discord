import { describe, expect, it } from "bun:test";
import { type NudgeRules, nudgeText, shouldNudge } from "./idle-nudge.ts";

const MIN = 60_000;
// 2026-10-10 15:00 em Sao Paulo (UTC-3).
const T0 = Date.parse("2026-10-10T18:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();

const rules: NudgeRules = { idleMs: 30 * MIN, quietStartHour: 0, quietEndHour: 9, timeZone: "America/Sao_Paulo" };

const human = (ms: number) => ({ createdAt: at(ms), fromBot: false });
const bot = (ms: number) => ({ createdAt: at(ms), fromBot: true });

describe("shouldNudge", () => {
	it("cutuca quando o ultimo humano falou ha 30 minutos", () => {
		expect(shouldNudge([human(T0)], T0 + 30 * MIN, rules)).toBe(true);
	});

	it("nao cutuca antes dos 30 minutos", () => {
		expect(shouldNudge([human(T0)], T0 + 29 * MIN, rules)).toBe(false);
	});

	it("nao cutuca canal sem nenhuma mensagem humana", () => {
		expect(shouldNudge([], T0, rules)).toBe(false);
		expect(shouldNudge([bot(T0)], T0 + 40 * MIN, rules)).toBe(false);
	});

	it("resposta do bot logo depois do humano nao conta como cutucao", () => {
		expect(shouldNudge([human(T0), bot(T0 + MIN)], T0 + 30 * MIN, rules)).toBe(true);
	});

	it("depois de cutucar fica quieto ate um humano falar de novo", () => {
		const history = [human(T0), bot(T0 + 30 * MIN)];
		expect(shouldNudge(history, T0 + 31 * MIN, rules)).toBe(false);
		expect(shouldNudge(history, T0 + 3 * 60 * MIN, rules)).toBe(false);
		const later = [...history, human(T0 + 3 * 60 * MIN)];
		expect(shouldNudge(later, T0 + 3 * 60 * MIN + 30 * MIN, rules)).toBe(true);
	});

	it("silencio velho (bot fora do ar) nao gera cutucao atrasado", () => {
		expect(shouldNudge([human(T0)], T0 + 60 * MIN, rules)).toBe(false);
	});

	it("nao cutuca no horario de silencio (00h-09h)", () => {
		// 23:50 em Sao Paulo: prazo cai 00:20.
		const late = Date.parse("2026-10-11T02:50:00.000Z");
		expect(shouldNudge([human(late)], late + 30 * MIN, rules)).toBe(false);
		// 08:40: prazo cai 09:10, fora do silencio.
		const morning = Date.parse("2026-10-11T11:40:00.000Z");
		expect(shouldNudge([human(morning)], morning + 30 * MIN, rules)).toBe(true);
	});

	it("silencio que atravessa a meia-noite (22h-07h)", () => {
		const night: NudgeRules = { ...rules, quietStartHour: 22, quietEndHour: 7 };
		const at2230 = Date.parse("2026-10-11T01:00:00.000Z"); // 22:00 SP + 30 min
		expect(shouldNudge([human(at2230 - 30 * MIN)], at2230, night)).toBe(false);
		const at2130 = Date.parse("2026-10-11T00:30:00.000Z"); // 21:30 SP
		expect(shouldNudge([human(at2130 - 30 * MIN)], at2130, night)).toBe(true);
	});
});

describe("nudgeText", () => {
	it("pede uma mensagem curta e traz a conversa recente", () => {
		const text = nudgeText(30, [
			{ authorName: "ana", body: "alguem joga hoje?" },
			{ authorName: "bia", body: "talvez" },
		]);
		expect(text).toContain("30 minutos");
		expect(text).toContain("ana: alguem joga hoje?");
		expect(text).toContain("bia: talvez");
	});

	it("cutucao forcado nao fala em tempo parado", () => {
		const text = nudgeText(undefined, [{ authorName: "ana", body: "oi" }]);
		expect(text).not.toContain("minutos");
		expect(text).toContain("ana: oi");
	});

	it("comandos (!...) ficam fora da conversa recente", () => {
		const text = nudgeText(30, [
			{ authorName: "ana", body: "oi" },
			{ authorName: "dono", body: "!cutucar" },
		]);
		expect(text).not.toContain("!cutucar");
	});
});
