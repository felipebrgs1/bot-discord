/**
 * Composition root: db → config → sessions → gateway (+ dashboard).
 *
 * Secrets come from the environment only (DISCORD_TOKEN, optional
 * DASHBOARD_PASSWORD); everything else lives in SQLite with code defaults.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { systemClock } from "./adapters/out/clock/system-clock.ts";
import type { ChatAgent } from "./application/ports/chat-agent.ts";
import type { Logger } from "./application/ports/logger.ts";
import { ReplyToMessage } from "./application/reply-to-message.ts";
import { SqliteConfigStore } from "./adapters/out/sqlite/config-store.ts";
import { openDatabase } from "./adapters/out/sqlite/db.ts";
import { DiscordGateway } from "./gateway.ts";
import { apiLlmCaller, familiarityBlock, startConsolidation } from "./memory/index.ts";
import { recordTurn } from "./metrics.ts";
import { SqliteSoulStore } from "./adapters/out/sqlite/soul-store.ts";

const DEFAULT_SOUL_FALLBACK = "Você é um amigo do servidor: direto, bem-humorado, fala PT-BR.";

import { roleOf } from "./domain/roles.ts";
import { ChannelSessions, piSessionFactory } from "./sessions.ts";
import { listaJogo } from "./tools/skidrow.ts";
import { startDashboard } from "./webapi.ts";
import { LogBuffer } from "./weblog.ts";

export interface StartOptions {
	dbPath: string;
	cwd?: string;
	/** Porta do painel; 0 = desligado. Padrão: DASHBOARD_PORT ou 8080. */
	dashboardPort?: number;
	dashboardHost?: string;
	/** Diretório com o build do front (web/dist). */
	webDir?: string;
}

/** Segredo so do ambiente; nunca do banco. */
const secret = (name: string): string => process.env[name] ?? "";

export async function startBot(options: StartOptions): Promise<() => Promise<void>> {
	// Secrets live in .env at the repo root (gitignored) — never in SQLite.
	loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

	const log = new LogBuffer();
	const emit = (msg: string, attrs?: Record<string, unknown>): void => log.log("info", msg, attrs);
	const db = openDatabase(options.dbPath);
	const config = new SqliteConfigStore(db);
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	const sessions = new ChannelSessions(
		piSessionFactory(options.cwd ?? process.cwd(), {
			db,
			log,
			outboxDir: join(root, "outbox"),
		}),
	);
	const souls = new SqliteSoulStore(db);
	souls.ensureSeed(config.all().bot.personality || DEFAULT_SOUL_FALLBACK);

	// ChatAgent provisorio: sessoes do pi + soul + familiaridade (vira adapter pi-agent).
	const agent: ChatAgent = {
		ask: ({ channelId, authorId, role, text, images }) => {
			const soul = souls.bodyFor(channelId);
			const familiar = familiarityBlock(db, { personId: authorId, channelId });
			const systemExtra = [soul, familiar].filter(Boolean).join("\n\n");
			return sessions.ask(channelId, role, text, {
				source: "discord",
				model: config.all().chat.model,
				systemExtra: systemExtra || undefined,
				images: images.map((i) => ({ type: "image" as const, data: i.data, mimeType: i.mimeType })),
				onTurn: (r) => recordTurn(db, r),
			});
		},
	};
	const logger: Logger = {
		info: (msg) => log.log("info", msg),
		warn: (msg) => log.log("warn", msg),
	};
	const replies = new ReplyToMessage({
		agent,
		clock: systemClock,
		logger,
		settings: () => {
			const s = config.all();
			return { cooldownMs: s.bot.reply_cooldown_ms, adminIds: s.discord.admin_ids };
		},
	});

	const gateway = new DiscordGateway({
		settings: () => config.all(),
		replies,
		onReady: (tag) => log.log("info", `logado no Discord como ${tag}`),
		emit,
		onCommand: async ({ channelId, authorId, text, reply }) => {
			const raw = text.trim();
			const cmd = raw.split(/\s+/);
			if (cmd[0] === "!lista" || cmd[0] === "/lista") {
				const jogo = raw.slice(cmd[0].length).trim();
				if (!jogo) {
					await reply("uso: /lista nome do jogo (ex.: /lista the sims)");
					return true;
				}
				try {
					await reply(await listaJogo(jogo));
				} catch (err) {
					await reply(`não rolou: ${err instanceof Error ? err.message : String(err)}`);
				}
				return true;
			}
			if (cmd[0] !== "!soul" && cmd[0] !== "!souls") return false;
			if (roleOf(authorId, config.all().discord.admin_ids) !== "admin") {
				await reply("só o dono troca a mente do bot.");
				return true;
			}
			if (cmd[0] === "!souls" || cmd.length < 2) {
				const names =
					souls
						.list()
						.map((x) => x.name)
						.join(", ") || "(nenhuma)";
				await reply(`souls: ${names} | aqui: ${souls.channelSoul(channelId)}`);
				return true;
			}
			try {
				souls.setChannel(channelId, cmd[1] as string);
				sessions.remove(channelId);
				await reply(`mente trocada: agora sou **${cmd[1]}** neste canal.`);
			} catch (err) {
				await reply(`não rolou: ${err instanceof Error ? err.message : String(err)}`);
			}
			return true;
		},
		outboxDir: join(root, "outbox"),
		persist: (m) => {
			try {
				db.prepare(
					"INSERT OR IGNORE INTO messages (channel_id, author_id, author_name, message_id, body, reply_to) VALUES (?,?,?,?,?,?);",
				).run(m.channelId, m.authorId, m.authorName, m.messageId, m.body.slice(0, 4000), m.replyTo ?? null);
			} catch {
				/* histórico nunca quebra resposta */
			}
		},
	});

	const chatKey = secret("CHAT_API_KEY") || secret("OPENCODE_API_KEY");
	const all = config.all();
	const stopConsolidation =
		chatKey && all.chat.model
			? startConsolidation(db, apiLlmCaller(all.chat.base_url, chatKey, all.chat.model), {
					channels: all.discord.channel_ids,
					batchSize: all.memory.batch_size,
					intervalMs: all.memory.interval_ms,
					onLog: (msg, attrs) => log.log("info", msg, attrs),
				})
			: undefined;
	if (!chatKey) log.log("warn", "sem CHAT_API_KEY/OPENCODE_API_KEY: consolidação desligada");

	const token = secret("DISCORD_TOKEN");
	if (!token) throw new Error("DISCORD_TOKEN não definido no ambiente");

	await gateway.start(token);

	const port = options.dashboardPort ?? (process.env["DASHBOARD_PORT"] ? Number(process.env["DASHBOARD_PORT"]) : 8080);
	let server: { close(cb?: () => void): void } | undefined;
	if (port > 0) {
		server = startDashboard(
			{
				db,
				config,
				sessions,
				log,
				webDir: options.webDir ?? join(root, "web", "dist"),
				password: secret("DASHBOARD_PASSWORD"),
				souls,
			},
			port,
			options.dashboardHost ?? "127.0.0.1",
		);
		log.log("info", `painel em http://127.0.0.1:${port}`);
	}

	let stopping = false;
	return async () => {
		if (stopping) return;
		stopping = true;
		stopConsolidation?.();
		config.dispose();
		replies.stop();
		await gateway.stop();
		sessions.dispose();
		if (server) await new Promise<void>((r) => server?.close(() => r()));
		db.close();
	};
}
