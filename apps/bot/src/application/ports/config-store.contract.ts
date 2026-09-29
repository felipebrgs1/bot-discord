import { expect, it } from "bun:test";
import { defaultSettings } from "../../domain/settings.ts";
import type { ConfigStore } from "./config-store.ts";

export function configStoreContract(make: () => ConfigStore): void {
	it("vazio serve os padroes", () => {
		const config = make();
		expect(config.all()).toEqual(defaultSettings());
		expect(config.get("chat.model")).toBe("");
	});

	it("set de chave pontuada aparece na hora", () => {
		const config = make();
		config.set("chat.model", "gpt-oss-120b");
		expect(config.get("chat.model")).toBe("gpt-oss-120b");
		expect(config.all().chat.model).toBe("gpt-oss-120b");
	});

	it("set de secao preserva padroes dos campos nao dados", () => {
		const config = make();
		config.set("discord", { channel_ids: ["c1"] });
		expect(config.all().discord.channel_ids).toEqual(["c1"]);
		expect(config.all().discord.guild_id).toBe("");
	});

	it("chave pontuada vence a secao", () => {
		const config = make();
		config.set("discord", { channel_ids: ["c1", "c2"] });
		config.set("discord.channel_ids", ["c2"]);
		expect(config.all().discord.channel_ids).toEqual(["c2"]);
	});

	it("regravar a mesma chave substitui", () => {
		const config = make();
		config.set("chat.model", "a");
		config.set("chat.model", "b");
		expect(config.get("chat.model")).toBe("b");
	});
}
