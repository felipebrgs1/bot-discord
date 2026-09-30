/**
 * Composition root: instancia adapters, injeta nos casos de uso e liga as
 * entradas (Discord, consolidacao, painel). Unico lugar que le o ambiente.
 */

import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { DiscordGateway } from "../adapters/in/discord/gateway.ts";
import { createPanelHandler, startPanel } from "../adapters/in/http-panel/server.ts";
import { botTools } from "../adapters/in/pi-tools/bot-tools.ts";
import { startConsolidationLoop } from "../adapters/in/scheduler/consolidation-loop.ts";
import { systemClock } from "../adapters/out/clock/system-clock.ts";
import { CodexImageGenerator } from "../adapters/out/codex/codex-image-generator.ts";
import { codexToken } from "../adapters/out/codex/codex-token.ts";
import { FsOutbox } from "../adapters/out/fs/outbox.ts";
import { ChatJsonExtractor } from "../adapters/out/llm/chat-json-extractor.ts";
import { LogBuffer } from "../adapters/out/log/log-buffer.ts";
import { PiChatAgent } from "../adapters/out/pi-agent/pi-chat-agent.ts";
import { PiSubAgents, type WorkerFactory } from "../adapters/out/pi-agent/pi-sub-agents.ts";
import { piSessionFactories, type SessionFactory, SessionPool } from "../adapters/out/pi-agent/session-pool.ts";
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
import { GenerateImage } from "../application/generate-image.ts";
import { MessageLog } from "../application/message-log.ts";
import { OutboxDelivery } from "../application/outbox-delivery.ts";
import { Panel } from "../application/panel.ts";
import { Persona } from "../application/persona.ts";
import { Recall } from "../application/recall.ts";
import { ReplyToMessage } from "../application/reply-to-message.ts";
import { SearchGames } from "../application/search-games.ts";
import { Swarm } from "../application/swarm.ts";
import { parseModelRef } from "../domain/model-ref.ts";
import { TextCommands } from "../application/text-commands.ts";
import { WebChat } from "../application/web-chat.ts";
import { WebResearch } from "../application/web-research.ts";

/** Modelo de chat que chama a tool de imagem no Codex; CODEX_IMAGE_MODEL tem precedencia. */
const DEFAULT_CODEX_IMAGE_MODEL = "gpt-5.5";

/** Instalado pelo setup do bot Go; YTDLP_BIN tem precedencia. */
const DEFAULT_YTDLP = "/home/ubuntu/bot/botdiscord/bin/yt-dlp";

export type Env = Record<string, string | undefined>;

export interface ComposeOptions {
	dbPath: string;
	/** Raiz do app do bot: personality.md e outbox/ ficam aqui. */
	root: string;
	/** Build do painel (apps/web/dist). */
	webDir: string;
	/** cwd das sessoes do pi. */
	cwd: string;
	env: Env;
	/** Troca a fabrica de sessoes do pi (teste de montagem, sem modelo real). */
	sessionFactory?: SessionFactory;
	/** Troca a fabrica de workers do /swarm (teste de montagem). */
	workerFactory?: WorkerFactory;
	/** Troca o fetch de saida (teste de montagem, sem rede). */
	http?: typeof fetch;
	/** Troca o token do Codex (teste de montagem, sem ler o auth.json do pi). */
	codexToken?: () => Promise<string>;
}

export function compose(opts: ComposeOptions) {
	const env = (name: string) => opts.env[name] ?? "";

	// Personalidade base (obrigatoria): relida a cada sessao nova, editar vale sem restart.
	const personalityPath = join(opts.root, "personality.md");
	const personality = (): string => {
		let text = "";
		try {
			text = readFileSync(personalityPath, "utf8").trim();
		} catch {
			/* tratado abaixo */
		}
		if (!text) throw new Error(`personality.md ausente ou vazio em ${personalityPath}`);
		return text;
	};
	personality();

	// Adapters de saida
	const log = new LogBuffer();
	const db = openDatabase(opts.dbPath);
	const config = new SqliteConfigStore(db);
	const souls = new SqliteSoulStore(db);
	// Soul e complemento por canal; a base vem do personality.md.
	souls.ensureSeed("");
	const messages = new SqliteMessageStore(db);
	const memories = new SqliteMemoryStore(db);
	const metrics = new SqliteMetrics(db);
	const guard = new DnsHostGuard({ allowPrivate: env("AGENT_ALLOW_PRIVATE") === "1" });
	const fetcher = new HttpPageFetcher(opts.http ? { guard, http: opts.http } : { guard });
	const outbox = new FsOutbox(join(opts.root, "outbox"));

	// Casos de uso
	const persona = new Persona(souls, memories, messages);
	const games = new SearchGames(new SkidrowCatalog(fetcher));
	const tools = {
		research: new WebResearch(new NewsWikiSearch(fetcher), fetcher),
		media: new DownloadMedia(new YtDlpDownloader(env("YTDLP_BIN") || DEFAULT_YTDLP, outbox), guard, log),
		recall: new Recall(messages, memories),
		// Imagem pela assinatura do ChatGPT: token do login openai-codex do pi.
		images: new GenerateImage(
			new CodexImageGenerator({
				http: opts.http ?? fetch,
				token: opts.codexToken ?? codexToken(),
				model: env("CODEX_IMAGE_MODEL") || DEFAULT_CODEX_IMAGE_MODEL,
			}),
			outbox,
			systemClock,
			log,
		),
		games,
	};
	// Modelo da conversa: AGENT_MODEL=provider/id no .env; vazio = padrao do pi.
	const agentModelText = env("AGENT_MODEL").trim();
	const agentModel = agentModelText ? parseModelRef(agentModelText) : undefined;
	if (agentModelText && !agentModel) throw new Error(`AGENT_MODEL inválido: "${agentModelText}" (use provider/id)`);
	const factories = piSessionFactories(opts.cwd, (conversationId) => botTools(tools, conversationId), personality, agentModel);
	const pool = new SessionPool(opts.sessionFactory ?? factories.conversations);
	const agent = new PiChatAgent({ pool, metrics, model: () => agentModelText });
	const swarm = new Swarm(
		new PiSubAgents({ factory: opts.workerFactory ?? factories.workers, metrics, model: () => agentModelText }),
	);
	const replies = new ReplyToMessage({
		agent,
		clock: systemClock,
		logger: log,
		settings: () => {
			const s = config.all();
			return { cooldownMs: s.bot.reply_cooldown_ms, adminIds: s.discord.admin_ids };
		},
		systemPromptFor: (channelId) => persona.systemPromptFor(channelId),
		turnText: (turn) => persona.turnText(turn),
	});
	const panel = new Panel({ config, souls, sessions: agent, memories, metrics, logs: log, agentModel: agentModelText });
	const webChat = new WebChat({
		messages,
		agent,
		swarm,
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
		media: tools.media,
		outbox: new OutboxDelivery(outbox, log),
		history: new MessageLog(messages, log),
		logger: log,
		clock: systemClock,
	});
	const panelDeps = {
		panel,
		chat: webChat,
		logger: log,
		webDir: opts.webDir,
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
		personality,
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
