import { describe, expect, it } from "bun:test";
import { memoryStoreContract } from "@/application/ports/memory-store.contract.ts";
import { openDatabase } from "./db.ts";
import { SqliteMemoryStore } from "./memory-store.ts";

describe("SqliteMemoryStore", () => {
	memoryStoreContract(() => new SqliteMemoryStore(openDatabase(":memory:")));

	it("bloco de pessoa leva o ultimo nome dela no historico", () => {
		const db = openDatabase(":memory:");
		const msg = db.prepare("INSERT INTO messages (channel_id, author_id, author_name, message_id, body) VALUES (?,?,?,?,?);");
		msg.run("c1", "u1", "ana_velha", "m1", "oi");
		msg.run("c1", "u1", "Ana", "m2", "oi");
		const store = new SqliteMemoryStore(db);
		store.write({ scope: "user", ownerId: "u1" }, ["odeia spoiler"], "add");
		store.write({ scope: "user", ownerId: "u9" }, ["x"], "add");
		store.write({ scope: "group", ownerId: "c1" }, ["sextou"], "add");
		expect(store.blocks().map((b) => [b.ownerId, b.name])).toEqual([
			["c1", "c1"],
			["u9", "u9"],
			["u1", "Ana"],
		]);
	});

	it("timeline inclui usos de skill", () => {
		const db = openDatabase(":memory:");
		db.prepare("INSERT INTO skill_runs (skill_name, channel_id, usage, result) VALUES (?,?,?,?);").run(
			"lista",
			"c1",
			"applied",
			"ok",
		);
		expect(new SqliteMemoryStore(db).timeline(10)).toEqual([
			expect.objectContaining({ kind: "skill", channelId: "c1", subject: "lista", detail: "applied (ok)" }),
		]);
	});
});
