/**
 * Composition root: instancia adapters, injeta nos casos de uso e liga as
 * entradas (Discord, consolidacao, painel). Unico lugar que le o ambiente.
 */

import type { Server } from "node:http";
import { join } from "node:path";
import { DiscordGateway } from "../adapters/in/discord/gateway.ts";
import { createPanelHandler, startPanel } from "../adapters/in/http-panel/server.ts";
import { botTools } from "../adapters/in/pi-tools/bot-tools.ts";
import { startConsolidationLoop } from "../adapters/in/scheduler/consolidation-loop.ts";
import { systemClock } from "../adapters/out/clock/system-clock.ts";
import { FsOutbox } from "../adapters/out/fs/outbox.ts";
import { ChatJsonExtractor } from "../adapters/out/llm/chat-json-extractor.ts";
import { LogBuffer } from "../adapters/out/log/log-buffer.ts";
import { PiChatAgent } from "../adapters/out/pi-agent/pi-chat-agent.ts";
import { piSessionFactory, type SessionFactory, SessionPool } from "../adapters/out/pi-agent/session-pool.ts";
import { SqliteConfigStore } from "../adapters/out/sqlite/config-store.ts";
import { openDatabase } from "../adapters/out/sqlite/db.ts";
import { SqliteMemoryStore } from "../adapters/out/sqlite/memory-store.ts";
import { SqliteMessageStore } from "../adapters/out/sqlite/message-store.ts";
import { SqliteMetrics } from "../adapters/out/sqlite/metrics.ts";
import { SqliteSoulStore } from "../adapters/out/sqlite/soul-store.ts";
import { DnsHostGuard } from "../adapters/out/web/host-guard.ts";
import { HttpPageFetcher } from "../adapters/out/web/http-fetcher.ts";
import { NewsWikiSearch } from "../adapters/out/web/news-wiki-search.ts";
import { SkidrowCatalog } from "../adapters/out/web/skidrow-catalog.ts";
import { YtDlpDownloader } from "../adapters/out/ytdlp/ytdlp-downloader.ts";
import { ConsolidateMemory } from "../application/consolidate-memory.ts";
import { DownloadImages } from "../application/download-images.ts";
import { DownloadMedia } from "../application/download-media.ts";
import { MessageLog } from "../application/message-log.ts";
import { OutboxDelivery } from "../application/outbox-delivery.ts";
import { Panel } from "../application/panel.ts";
import { Persona } from "../application/persona.ts";
import { Recall } from "../application/recall.ts";
import { ReplyToMessage } from "../application/reply-to-message.ts";
import { SearchGames } from "../application/search-games.ts";
import { TextCommands } from "../application/text-commands.ts";
import { WebChat } from "../application/web-chat.ts";
import { WebResearch } from "../application/web-research.ts";

const DEFAULT_SOUL_FALLBACK = "Você é um amigo do servidor: direto, bem-humorado, fala PT-BR.";
/** Instalado pelo setup do bot Go; YTDLP_BIN tem precedencia. */
const DEFAULT_YTDLP = "/home/ubuntu/bot/botdiscord/bin/yt-dlp";

export type Env = Record<string, string | undefined>;

export interface ComposeOptions {
	dbPath: string;
	/** Raiz do repo: outbox/ e web/dist/ ficam aqui. */
	root: string;
	/** cwd das sessoes do pi. */
	cwd: string;
	env: Env;
	/** Troca a fabrica de sessoes do pi (teste de montagem, sem modelo real). */
	sessionFactory?: SessionFactory;
	/** Troca o fetch de saida (teste de montagem, sem rede). */
	http?: typeof fetch;
}

export function compose(opts: ComposeOptions) {
	const env = (name: string) => opts.env[name] ?? "";

	// Adapters de saida
	const log = new LogBuffer();
	const db = openDatabase(opts.dbPath);
	const config = new SqliteConfigStore(db);
	const souls = new SqliteSoulStore(db);
	souls.ensureSeed(config.all().bot.personality || DEFAULT_SOUL_FALLBACK);
	const messages = new SqliteMessageStore(db);
	const memories = new SqliteMemoryStore(db);
	const metrics = new SqliteMetrics(db);
	const guard = new DnsHostGuard({ allowPrivate: env("AGENT_ALLOW_PRIVATE") === "1" });
	const fetcher = new HttpPageFetcher(opts.http ? { guard, http: opts.http } : { guard });
	const outbox = new FsOutbox(join(opts.root, "outbox"));

	// Casos de uso
	const persona = new Persona(souls, memories);
	const games = new SearchGames(new SkidrowCatalog(fetcher));
	const tools = {
		research: new WebResearch(new NewsWikiSearch(fetcher), fetcher),
		media: new DownloadMedia(new YtDlpDownloader(env("YTDLP_BIN") || DEFAULT_YTDLP, outbox), guard, log),
		recall: new Recall(messages, memories),
		games,
	};
	const pool = new SessionPool(
		opts.sessionFactory ?? piSessionFactory(opts.cwd, (conversationId) => botTools(tools, conversationId)),
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
	const panel = new Panel({ config, souls, sessions: agent, memories, metrics, logs: log });
	const webChat = new WebChat({
		messages,
		agent,
		config,
		persona,
		clock: systemClock,
		newId: () => `web-${crypto.randomUUID()}`,
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
	const panelDeps = {
		panel,
		chat: webChat,
		logger: log,
		webDir: join(opts.root, "web", "dist"),
		password: env("DASHBOARD_PASSWORD"),
	};

	const chatKey = env("CHAT_API_KEY") || env("OPENCODE_API_KEY");
	const startConsolidation = (): (() => void) | undefined => {
		const boot = config.all();
		if (!chatKey || !boot.chat.model) {
			log.warn("sem CHAT_API_KEY/OPENCODE_API_KEY ou chat.model: consolidação desligada");
			return undefined;
		}
		const extractor = new ChatJsonExtractor({ baseUrl: boot.chat.base_url, apiKey: chatKey, model: boot.chat.model });
		return startConsolidationLoop(new ConsolidateMemory({ messages, memories, logger: log, extractor }), {
			channels: () => config.all().discord.channel_ids,
			batchSize: boot.memory.batch_size,
			intervalMs: boot.memory.interval_ms,
		});
	};

	return {
		log,
		db,
		config,
		agent,
		tools: (conversationId: string) => botTools(tools, conversationId),
		panelHandler: () => createPanelHandler(panelDeps),

		/** Liga Discord, consolidacao e painel; devolve o desligamento. */
		async start(): Promise<() => Promise<void>> {
			const token = env("DISCORD_TOKEN");
			if (!token) throw new Error("DISCORD_TOKEN não definido no ambiente");
			const stopConsolidation = startConsolidation();
			await gateway.start(token);
			const port = env("DASHBOARD_PORT") ? Number(env("DASHBOARD_PORT")) : 8080;
			let server: Server | undefined;
			if (port > 0) {
				server = startPanel(panelDeps, port, env("DASHBOARD_HOST") || "127.0.0.1");
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
		},
	};
}
