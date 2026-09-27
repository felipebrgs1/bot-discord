/**
 * Composition root: le o ambiente, instancia adapters, injeta nos casos de
 * uso e sobe Discord, consolidacao e painel. Segredos so do ambiente.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { DiscordGateway } from "./adapters/in/discord/gateway.ts";
import { botTools } from "./adapters/in/pi-tools/bot-tools.ts";
import { startConsolidationLoop } from "./adapters/in/scheduler/consolidation-loop.ts";
import { systemClock } from "./adapters/out/clock/system-clock.ts";
import { FsOutbox } from "./adapters/out/fs/outbox.ts";
import { ChatJsonExtractor } from "./adapters/out/llm/chat-json-extractor.ts";
import { LogBuffer } from "./adapters/out/log/log-buffer.ts";
import { PiChatAgent } from "./adapters/out/pi-agent/pi-chat-agent.ts";
import { piSessionFactory, SessionPool } from "./adapters/out/pi-agent/session-pool.ts";
import { SqliteConfigStore } from "./adapters/out/sqlite/config-store.ts";
import { openDatabase } from "./adapters/out/sqlite/db.ts";
import { SqliteMemoryStore } from "./adapters/out/sqlite/memory-store.ts";
import { SqliteMessageStore } from "./adapters/out/sqlite/message-store.ts";
import { SqliteMetrics } from "./adapters/out/sqlite/metrics.ts";
import { SqliteSoulStore } from "./adapters/out/sqlite/soul-store.ts";
import { DnsHostGuard } from "./adapters/out/web/host-guard.ts";
import { HttpPageFetcher } from "./adapters/out/web/http-fetcher.ts";
import { NewsWikiSearch } from "./adapters/out/web/news-wiki-search.ts";
import { SkidrowCatalog } from "./adapters/out/web/skidrow-catalog.ts";
import { YtDlpDownloader } from "./adapters/out/ytdlp/ytdlp-downloader.ts";
import { ConsolidateMemory } from "./application/consolidate-memory.ts";
import { DownloadImages } from "./application/download-images.ts";
import { DownloadMedia } from "./application/download-media.ts";
import { MessageLog } from "./application/message-log.ts";
import { OutboxDelivery } from "./application/outbox-delivery.ts";
import { Persona } from "./application/persona.ts";
import { Recall } from "./application/recall.ts";
import { ReplyToMessage } from "./application/reply-to-message.ts";
import { SearchGames } from "./application/search-games.ts";
import { TextCommands } from "./application/text-commands.ts";
import { WebResearch } from "./application/web-research.ts";
import { startDashboard } from "./webapi.ts";

const DEFAULT_SOUL_FALLBACK = "Você é um amigo do servidor: direto, bem-humorado, fala PT-BR.";
/** Instalado pelo setup do bot Go; YTDLP_BIN tem precedencia. */
const DEFAULT_YTDLP = "/home/ubuntu/bot/botdiscord/bin/yt-dlp";

/** Segredo so do ambiente; nunca do banco. */
const secret = (name: string): string => process.env[name] ?? "";

export interface StartOptions {
	dbPath: string;
	cwd?: string;
	/** Porta do painel; 0 = desligado. Padrao: DASHBOARD_PORT ou 8080. */
	dashboardPort?: number;
	dashboardHost?: string;
	/** Diretorio com o build do front (web/dist). */
	webDir?: string;
}

export async function startBot(options: StartOptions): Promise<() => Promise<void>> {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..");
	loadEnv({ path: join(root, ".env") });

	// Adapters de saida
	const log = new LogBuffer();
	const db = openDatabase(options.dbPath);
	const config = new SqliteConfigStore(db);
	const souls = new SqliteSoulStore(db);
	souls.ensureSeed(config.all().bot.personality || DEFAULT_SOUL_FALLBACK);
	const messages = new SqliteMessageStore(db);
	const memories = new SqliteMemoryStore(db);
	const metrics = new SqliteMetrics(db);
	const guard = new DnsHostGuard({ allowPrivate: process.env["AGENT_ALLOW_PRIVATE"] === "1" });
	const fetcher = new HttpPageFetcher({ guard });
	const outbox = new FsOutbox(join(root, "outbox"));

	// Casos de uso
	const persona = new Persona(souls, memories);
	const games = new SearchGames(new SkidrowCatalog(fetcher));
	const tools = {
		research: new WebResearch(new NewsWikiSearch(fetcher), fetcher),
		media: new DownloadMedia(new YtDlpDownloader(secret("YTDLP_BIN") || DEFAULT_YTDLP, outbox), guard, log),
		recall: new Recall(messages, memories),
		games,
	};
	const pool = new SessionPool(
		piSessionFactory(options.cwd ?? process.cwd(), (conversationId) => botTools(tools, conversationId)),
	);
	const agent = new PiChatAgent({ pool, metrics, model: () => config.all().chat.model });
	const replies = new ReplyToMessage({
		agent,
		clock: systemClock,
		logger: log,
		settings: () => {
			const s = config.all();
			return { cooldownMs: s.bot.reply_cooldown_ms, adminIds: s.discord.admin_ids };
		},
		systemPromptFor: (channelId, authorId) => persona.systemPromptFor(channelId, authorId),
	});

	// Adapters de entrada
	const gateway = new DiscordGateway({
		config,
		replies,
		commands: new TextCommands({ games, souls, sessions: agent, adminIds: () => config.all().discord.admin_ids }),
		games,
		images: new DownloadImages(fetcher),
		outbox: new OutboxDelivery(outbox, log),
		history: new MessageLog(messages, log),
		logger: log,
		clock: systemClock,
	});

	const chatKey = secret("CHAT_API_KEY") || secret("OPENCODE_API_KEY");
	const boot = config.all();
	const stopConsolidation =
		chatKey && boot.chat.model
			? startConsolidationLoop(
					new ConsolidateMemory({
						messages,
						memories,
						logger: log,
						extractor: new ChatJsonExtractor({ baseUrl: boot.chat.base_url, apiKey: chatKey, model: boot.chat.model }),
					}),
					{
						channels: () => config.all().discord.channel_ids,
						batchSize: boot.memory.batch_size,
						intervalMs: boot.memory.interval_ms,
					},
				)
			: undefined;
	if (!chatKey) log.warn("sem CHAT_API_KEY/OPENCODE_API_KEY: consolidação desligada");

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
				agent,
				log,
				metrics,
				webDir: options.webDir ?? join(root, "web", "dist"),
				password: secret("DASHBOARD_PASSWORD"),
				souls,
				persona,
			},
			port,
			options.dashboardHost ?? "127.0.0.1",
		);
		log.info(`painel em http://127.0.0.1:${port}`);
	}

	let stopping = false;
	return async () => {
		if (stopping) return;
		stopping = true;
		stopConsolidation?.();
		config.dispose();
		replies.stop();
		await gateway.stop();
		pool.dispose();
		if (server) await new Promise<void>((r) => server?.close(() => r()));
		db.close();
	};
}
