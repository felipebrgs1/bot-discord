#!/usr/bin/env bun
/**
 * Sobe o bot: `bun src/main/run.ts`. Segredos em .env na raiz (DISCORD_TOKEN,
 * CHAT_API_KEY/OPENCODE_API_KEY, DASHBOARD_PASSWORD...). Banco: BOT_DB ou data/bot.db.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { compose } from "./compose.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
loadEnv({ path: join(root, ".env") });
const dbPath = process.env["BOT_DB"] ?? join(root, "data", "bot.db");

const stop = await compose({ dbPath, root, cwd: process.cwd(), env: process.env }).start();
console.log(`discord-bot online (db=${dbPath})`);

const shutdown = async (signal: string) => {
	console.log(`recebido ${signal}, desligando...`);
	await stop();
	process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
