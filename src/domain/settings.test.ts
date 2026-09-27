import { describe, expect, it } from "bun:test";
import { defaultSettings, getSetting, settingsFrom } from "./settings.ts";

describe("defaultSettings", () => {
	it("tem valor para toda chave: banco vazio funciona", () => {
		const s = defaultSettings();
		expect(s.discord).toEqual({ guild_id: "", channel_ids: [], admin_ids: [] });
		expect(s.bot.reply_cooldown_ms).toBe(4000);
		expect(s.chat.model).toBe("");
		expect(s.memory.batch_size).toBe(50);
		expect(s.judge.enabled).toBe(false);
		expect(s.dashboard.web_user_id).toBe("");
	});

	it("devolve copia nova: mexer numa nao afeta a proxima", () => {
		defaultSettings().discord.channel_ids.push("x");
		expect(defaultSettings().discord.channel_ids).toEqual([]);
	});
});

describe("settingsFrom", () => {
	it("sem entradas sao os padroes", () => {
		expect(settingsFrom([])).toEqual(defaultSettings());
	});

	it("chave de secao sobrepoe so os campos dados", () => {
		const s = settingsFrom([{ key: "discord", value: { channel_ids: ["c1"] } }]);
		expect(s.discord.channel_ids).toEqual(["c1"]);
		expect(s.discord.guild_id).toBe("");
	});

	it("chave pontuada troca um campo", () => {
		expect(settingsFrom([{ key: "chat.model", value: "gpt-x" }]).chat.model).toBe("gpt-x");
	});

	it("pontuada vence secao, em qualquer ordem", () => {
		const s = settingsFrom([
			{ key: "discord.channel_ids", value: ["c2"] },
			{ key: "discord", value: { channel_ids: ["c1", "c2"] } },
		]);
		expect(s.discord.channel_ids).toEqual(["c2"]);
	});

	it("ignora secao desconhecida e valor de secao que nao e objeto", () => {
		const s = settingsFrom([
			{ key: "inventada", value: { a: 1 } },
			{ key: "bot", value: "texto" },
		]);
		expect(s).toEqual(defaultSettings());
	});
});

describe("getSetting", () => {
	it("le chave pontuada; caminho inexistente e undefined", () => {
		const s = defaultSettings();
		expect(getSetting(s, "bot.reply_cooldown_ms")).toBe(4000);
		expect(getSetting(s, "bot.nada.aqui")).toBeUndefined();
	});
});
