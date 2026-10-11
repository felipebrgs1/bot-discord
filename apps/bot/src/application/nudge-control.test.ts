import { describe, expect, it } from "bun:test";
import { FakeConfigStore } from "../test-support/fakes/config-store.ts";
import { NudgeControl } from "./nudge-control.ts";

function setup() {
	const config = new FakeConfigStore();
	const control = new NudgeControl({ config, adminIds: () => ["dono"] });
	return { config, control };
}

describe("NudgeControl", () => {
	it("sem opcoes mostra o estado atual", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "dono" })).toBe("cutucão ligado: puxo assunto depois de 30 min de canal parado.");
		config.set("nudge.enabled", false);
		expect(control.apply({ authorId: "dono" })).toBe("cutucão desligado.");
	});

	it("desliga e liga o cutucao", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "dono", enabled: false })).toBe("cutucão desligado.");
		expect(config.all().nudge.enabled).toBe(false);
		expect(control.apply({ authorId: "dono", enabled: true })).toBe("cutucão ligado: puxo assunto depois de 30 min de canal parado.");
		expect(config.all().nudge.enabled).toBe(true);
	});

	it("troca o tempo de silencio, junto ou nao com o toggle", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "dono", idleMin: 45 })).toBe("cutucão ligado: puxo assunto depois de 45 min de canal parado.");
		expect(config.all().nudge.idle_min).toBe(45);
		control.apply({ authorId: "dono", enabled: false, idleMin: 60 });
		expect(config.all().nudge).toMatchObject({ enabled: false, idle_min: 60 });
	});

	it("recusa tempo fora de 5 a 1440 minutos sem mudar nada", () => {
		const { control, config } = setup();
		for (const idleMin of [4, 1441, 7.5]) {
			expect(control.apply({ authorId: "dono", enabled: false, idleMin })).toBe("tempo entre 5 e 1440 minutos, inteiro.");
		}
		expect(config.all().nudge).toMatchObject({ enabled: true, idle_min: 30 });
	});

	it("so o admin mexe", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "u1", enabled: false })).toBe("só o dono mexe no cutucão.");
		expect(control.apply({ authorId: "u1" })).toBe("só o dono mexe no cutucão.");
		expect(config.all().nudge.enabled).toBe(true);
	});
});
