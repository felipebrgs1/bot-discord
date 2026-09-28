import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "bun:test";
import { migrate, openDatabase, schemaVersion } from "./db.ts";

function memDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	return db;
}

describe("migrations", () => {
	it("applies all migrations and reports the version", () => {
		const db = memDb();
		expect(schemaVersion(db)).toBe(5);
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name;")
			.all() as { name: string }[];
		const names = new Set(tables.map((t) => t.name));
		for (const t of [
			"config",
			"messages",
			"messages_fts",
			"memories",
			"memories_fts",
			"memory_versions",
			"episodes",
			"rolling_summaries",
			"interaction_events",
			"skill_runs",
			"participation_actions",
			"open_loops",
			"ai_requests",
			"souls",
			"memory_cursors",
			"channel_soul",
			"schema_migrations",
		]) {
			expect(names.has(t), `missing ${t}`).toBe(true);
		}
		const cacheCols = db.prepare("SELECT name FROM pragma_table_info('ai_requests');").all() as { name: string }[];
		const cacheNames = new Set(cacheCols.map((c) => c.name));
		expect(cacheNames.has("cached_tokens")).toBe(true);
		expect(cacheNames.has("cache_write_tokens")).toBe(true);
		db.close();
	});

	it("is idempotent", () => {
		const db = memDb();
		migrate(db);
		expect(schemaVersion(db)).toBe(5);
		db.close();
	});

	it("openDatabase enables WAL", () => {
		const db = openDatabase(":memory:");
		const row = db.prepare("PRAGMA journal_mode;").get() as { journal_mode: string };
		expect(row.journal_mode.toLowerCase()).toBe("memory");
		db.close();
	});
});

describe("v5 memory-version-ids", () => {
	it("liga versoes antigas a memoria certa por chave, escopo, pessoa e canal", () => {
		const db = new DatabaseSync(":memory:");
		migrate(db, 4);
		const insert = db.prepare(
			"INSERT INTO memories (key, kind, scope, person_id, channel_id, content) VALUES (?,?,?,?,?,?);",
		);
		const ana = Number(insert.run("jogo", "fact", "user", "ana", "c1", "Terraria").lastInsertRowid);
		const bruno = Number(insert.run("jogo", "fact", "user", "bruno", "c1", "LoL").lastInsertRowid);
		const version = db.prepare(
			"INSERT INTO memory_versions (memory_key, scope, person_id, channel_id, content) VALUES (?,?,?,?,?);",
		);
		version.run("jogo", "user", "ana", "c1", "Terraria");
		version.run("jogo", "user", "bruno", "c1", "LoL");
		migrate(db);
		const rows = db.prepare("SELECT content, memory_id FROM memory_versions ORDER BY rowid;").all();
		expect(rows).toEqual([
			{ content: "Terraria", memory_id: ana },
			{ content: "LoL", memory_id: bruno },
		]);
		db.close();
	});
});

describe("memories_fts", () => {
	it("finds inserted memories by keyword", () => {
		const db = memDb();
		db.prepare("INSERT INTO memories (key, kind, scope, person_id, channel_id, content) VALUES (?,?,?,?,?,?);").run(
			"jogo-favorito",
			"preference",
			"user",
			"u1",
			"c1",
			"Meu jogo favorito é Terraria",
		);
		const hits = db.prepare("SELECT content FROM memories_fts WHERE memories_fts MATCH ?;").all("Terraria") as {
			content: string;
		}[];
		expect(hits).toHaveLength(1);
		expect(hits[0]?.content).toContain("Terraria");
		db.close();
	});
});
