import { describe, expect, it } from "bun:test";
import { memoryStoreContract } from "../../../application/ports/memory-store.contract.ts";
import { openDatabase } from "./db.ts";
import { SqliteMemoryStore } from "./memory-store.ts";

describe("SqliteMemoryStore", () => {
	memoryStoreContract(() => new SqliteMemoryStore(openDatabase(":memory:")));

	it("commit que falha no meio nao grava nada nem avanca o cursor", () => {
		const db = openDatabase(":memory:");
		const store = new SqliteMemoryStore(db);
		db.exec("DROP TABLE episodes;");
		expect(() =>
			store.commit(
				"c1",
				{
					summary: "",
					memories: [{ key: "a", kind: "fact", scope: "group", personId: "", content: "x" }],
					forget: [],
					confirm: [],
					episodes: [{ key: "e", title: "t", summary: "s" }],
				},
				5,
			),
		).toThrow();
		expect(store.cursor("c1")).toBe(0);
		expect(store.listActive(10)).toEqual([]);
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
