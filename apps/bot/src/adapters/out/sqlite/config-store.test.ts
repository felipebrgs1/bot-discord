import { describe, expect, it } from "bun:test";
import { configStoreContract } from "../../../application/ports/config-store.contract.ts";
import { SqliteConfigStore } from "./config-store.ts";
import { openDatabase } from "./db.ts";

describe("SqliteConfigStore", () => {
	configStoreContract(() => new SqliteConfigStore(openDatabase(":memory:")));

	it("registra quando cada chave foi gravada", () => {
		const config = new SqliteConfigStore(openDatabase(":memory:"));
		expect(config.updatedAt("chat.model")).toBe("");
		config.set("chat.model", "x");
		expect(config.updatedAt("chat.model")).not.toBe("");
	});

	it("avisa assinantes quando uma chave muda", () => {
		const config = new SqliteConfigStore(openDatabase(":memory:"), 20);
		const seen: string[] = [];
		const unsubscribe = config.subscribe((k) => seen.push(k));
		config.set("bot.personality", "seco e direto");
		expect(seen).toContain("bot.personality");
		unsubscribe();
		config.dispose();
	});

	it("valor corrompido no banco cai no padrao", () => {
		const db = openDatabase(":memory:");
		db.prepare("INSERT INTO config (key, value) VALUES (?, ?);").run("chat.model", "{nao-json");
		expect(new SqliteConfigStore(db).get("chat.model")).toBe("");
	});
});
