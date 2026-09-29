import { describe, expect, it } from "bun:test";
import type { ChatSession } from "@elmatadore/api";
import { groupSessions } from "./sessions.ts";

const s = (id: string, updated_at: string): ChatSession => ({ id, title: id, updated_at, messages: 1 });

describe("groupSessions", () => {
	const now = new Date(2026, 8, 29, 15, 0, 0);

	it("agrupa por dia da atualizacao, mais novas primeiro", () => {
		const groups = groupSessions(
			[
				s("velha", new Date(2026, 7, 1).toISOString()),
				s("hoje-cedo", new Date(2026, 8, 29, 8).toISOString()),
				s("ontem", new Date(2026, 8, 28, 23).toISOString()),
				s("hoje-tarde", new Date(2026, 8, 29, 14).toISOString()),
				s("semana", new Date(2026, 8, 24).toISOString()),
			],
			now,
		);
		expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
			["Hoje", ["hoje-tarde", "hoje-cedo"]],
			["Ontem", ["ontem"]],
			["7 dias", ["semana"]],
			["Antes", ["velha"]],
		]);
	});

	it("omite grupos vazios", () => {
		expect(groupSessions([], now)).toEqual([]);
	});
});
