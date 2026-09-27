#!/usr/bin/env bun
/**
 * Semeia o banco a partir de um JSON (import unico, idempotente).
 *
 *   bun scripts/seed.ts <seed.json> <bot.db>
 *
 * O JSON mapeia secoes do config (discord, chat, bot, memory, judge) para
 * objetos. Rodar de novo sobrescreve as mesmas chaves.
 */

import { readFileSync } from "node:fs";
import { SqliteConfigStore } from "../src/adapters/out/sqlite/config-store.ts";
import { openDatabase } from "../src/adapters/out/sqlite/db.ts";

const [seedPath, dbPath] = process.argv.slice(2);
if (!seedPath || !dbPath) {
	console.error("uso: bun scripts/seed.ts <seed.json> <bot.db>");
	process.exit(1);
}

const seed = JSON.parse(readFileSync(seedPath, "utf-8")) as Record<string, unknown>;
const db = openDatabase(dbPath);
const config = new SqliteConfigStore(db);
for (const [section, value] of Object.entries(seed)) {
	config.set(section, value);
	console.log(`semeado: ${section}`);
}
config.dispose();
db.close();
