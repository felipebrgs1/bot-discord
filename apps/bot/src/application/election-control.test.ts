import { describe, expect, it } from "bun:test";
import { FakeConfigStore } from "@/test-support/fakes/config-store.ts";
import { ElectionControl } from "./election-control.ts";

const ON = "apuração ligada em <#c1>: resumo a cada 30 min e thread por estado a cada 1h.";

function setup() {
	const config = new FakeConfigStore();
	const control = new ElectionControl({ config, adminIds: () => ["dono"] });
	return { config, control };
}

describe("ElectionControl", () => {
	it("liga no canal onde o comando foi usado", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "dono", channelId: "c1", enabled: true })).toBe(ON);
		expect(config.all().election).toMatchObject({ enabled: true, channel_id: "c1" });
	});

	it("desliga sem esquecer o canal", () => {
		const { control, config } = setup();
		control.apply({ authorId: "dono", channelId: "c1", enabled: true });
		expect(control.apply({ authorId: "dono", channelId: "c2", enabled: false })).toBe("apuração desligada.");
		expect(config.all().election).toMatchObject({ enabled: false, channel_id: "c1" });
	});

	it("sem opcao mostra o estado", () => {
		const { control } = setup();
		expect(control.apply({ authorId: "dono", channelId: "c1" })).toBe("apuração desligada.");
		control.apply({ authorId: "dono", channelId: "c1", enabled: true });
		expect(control.apply({ authorId: "dono", channelId: "c9" })).toBe(ON);
	});

	it("so o admin mexe", () => {
		const { control, config } = setup();
		expect(control.apply({ authorId: "u1", channelId: "c1", enabled: true })).toBe("só o dono mexe na apuração.");
		expect(config.all().election.enabled).toBe(false);
	});
});
