/**
 * Discord gateway (Fase 1): events → sessions → replies.
 *
 * Same trigger rules as the Go bot:
 * - only allowlisted guild text channels (DMs, bots and webhooks ignored)
 * - reply when mentioned or when replying to one of our messages
 * - per-channel cooldown, FIFO queue of 8 pending replies
 */

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	Events,
	GatewayIntentBits,
	type Interaction,
	type Message,
	type OmitPartialGroupDMChannel,
} from "discord.js";
import type { BotSettings } from "./config.ts";
import { discard, pendingAttachments } from "./outbox.ts";
import { roleOf } from "./roles.ts";
import { splitMessage } from "./domain/reply-split.ts";
import { fetchMagnet, LISTA_COMMAND_JSON, listaEmbed, type SkidrowHit, searchSkidrow } from "./tools/skidrow.ts";
import { collectImageUrls, downloadImages, MAX_VISION_IMAGES, type VisionImage } from "./vision.ts";

/** Itera Collection/Map de anexos (ou nada, quando ausente). */
function valuesOf<T>(c: { values(): Iterable<T> } | undefined): Iterable<T> | undefined {
	try {
		return c?.values();
	} catch {
		return undefined;
	}
}

interface ReferencedMessage {
	attachments?: { values(): Iterable<{ contentType?: string | null; url: string }> };
	stickers?: { values(): Iterable<{ url: string }> };
	embeds?: { thumbnail?: { url?: string }; image?: { url?: string } }[];
}

/** Capas de embeds (ex.: resultado do /lista). */
function embedImageUrls(embeds: ReferencedMessage["embeds"]): string[] {
	const out: string[] = [];
	for (const e of embeds ?? []) {
		for (const url of [e.thumbnail?.url, e.image?.url]) {
			if (url && !url.endsWith(".json") && !out.includes(url)) out.push(url);
		}
	}
	return out;
}

interface HistoryMessage {
	id: string;
	attachments?: { values(): Iterable<{ contentType?: string | null; url: string }> };
	stickers?: { values(): Iterable<{ url: string }> };
	embeds?: ReferencedMessage["embeds"];
}

/**
 * Fotos recentes do canal via API (sobrevive a restart; pega foto de antes
 * do boot). Só usado quando não há imagem direta nem na memória curta.
 */
async function channelHistoryImageUrls(m: GuildMessage): Promise<string[]> {
	const fetch = (
		m.channel.messages as unknown as {
			fetch?: (opts: { limit: number }) => Promise<{ values(): Iterable<HistoryMessage> }>;
		}
	).fetch;
	if (typeof fetch !== "function") return [];
	let batch: { values(): Iterable<HistoryMessage> };
	try {
		batch = await fetch({ limit: 10 });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const msg of batch.values()) {
		if (msg.id === m.id || out.length >= MAX_VISION_IMAGES) continue;
		for (const u of [
			...collectImageUrls(
				valuesOf(msg.attachments) as Iterable<{ contentType?: string | null; url: string }> | undefined,
				valuesOf(msg.stickers) as Iterable<{ url: string }> | undefined,
			),
			...embedImageUrls(msg.embeds),
		]) {
			if (out.length >= MAX_VISION_IMAGES) break;
			if (!out.includes(u)) out.push(u);
		}
	}
	return out;
}

/**
 * Imagens da mensagem respondida (reply com foto): anexos + stickers +
 * capas de embeds (ex.: reply no /lista). Falha isolada = sem imagem extra.
 */
async function referencedImageUrls(m: GuildMessage): Promise<string[]> {
	const refId = m.reference?.messageId;
	const fetch = (m.channel.messages as unknown as { fetch?: (id: string) => Promise<ReferencedMessage> }).fetch;
	if (!refId || typeof fetch !== "function") return [];
	let ref: ReferencedMessage;
	try {
		ref = await fetch(refId);
	} catch {
		return [];
	}
	const out = collectImageUrls(
		valuesOf(ref.attachments) as Iterable<{ contentType?: string | null; url: string }> | undefined,
		valuesOf(ref.stickers) as Iterable<{ url: string }> | undefined,
	);
	for (const u of embedImageUrls(ref.embeds)) {
		if (!out.includes(u)) out.push(u);
	}
	return out;
}

export type Respond = (channelId: string, authorId: string, text: string, images?: VisionImage[]) => Promise<string>;

export interface CommandCtx {
	channelId: string;
	authorId: string;
	text: string;
	reply: (text: string) => Promise<unknown>;
}

export type CommandHandler = (ctx: CommandCtx) => Promise<boolean>;

export interface PersistedMessage {
	channelId: string;
	authorId: string;
	authorName: string;
	messageId: string;
	body: string;
	replyTo?: string;
}

type GuildMessage = OmitPartialGroupDMChannel<Message<boolean>>;

interface Incoming {
	message: GuildMessage;
	channelId: string;
	authorId: string;
	text: string;
	images: VisionImage[];
}

export function isEligibleChannel(message: Message, settings: BotSettings): boolean {
	if (message.guildId == null) return false; // DMs ignored (like the Go bot)
	if (message.guildId !== settings.discord.guild_id && settings.discord.guild_id !== "") {
		return false;
	}
	return settings.discord.channel_ids.includes(message.channelId);
}

export function isTrigger(message: GuildMessage, botUserId: string): boolean {
	if (message.author.bot || message.author.system) return false;
	if (message.webhookId) return false;
	if (message.mentions.has(botUserId)) return true;
	const ref = message.reference;
	if (ref?.messageId) {
		const replied = message.channel.messages.cache.get(ref.messageId);
		if (replied?.author.id === botUserId) return true;
	}
	return false;
}

const MAX_QUEUE = 8;

const WORKING_EMOJI = "\u23F1\uFE0F"; // ⏱️ while working
const DONE_EMOJI = "\u2705"; // ✅ on success
const ERROR_EMOJI = "\u274C"; // ❌ on failure

interface Reactable {
	react(emoji: string): Promise<unknown>;
	reactions: { cache: Map<string, { users: { remove(id: string): Promise<unknown> } }> };
	channel: { sendTyping(): Promise<unknown> };
}

async function tryReact(message: Reactable, emoji: string): Promise<void> {
	try {
		await message.react(emoji);
	} catch {
		/* missing permission or unknown emoji: reply still goes through */
	}
}

async function tryUnreact(message: Reactable, botUserId: string, emoji: string): Promise<void> {
	try {
		await message.reactions.cache.get(emoji)?.users.remove(botUserId);
	} catch {
		/* best effort */
	}
}

/**
 * Working indicator: ⏱️ + typing while `work()` runs, swapped for ✅/❌ after.
 * Reactions never break the reply — every step is best-effort.
 */
export async function trackWorking<T>(message: Reactable, botUserId: string, work: () => Promise<T>): Promise<T> {
	await tryReact(message, WORKING_EMOJI);
	// Detached keep-alive: sendTyping expires after ~10s, so refresh until
	// work() settles. Fire-and-forget on purpose — awaiting it would delay
	// the reply by one sleep cycle.
	let typing = true;
	void (async () => {
		while (typing) {
			try {
				await message.channel.sendTyping();
			} catch {
				/* ignore */
			}
			await new Promise((r) => setTimeout(r, 9000));
		}
	})();
	try {
		const result = await work();
		typing = false;
		await tryUnreact(message, botUserId, WORKING_EMOJI);
		await tryReact(message, DONE_EMOJI);
		return result;
	} catch (err) {
		typing = false;
		await tryUnreact(message, botUserId, WORKING_EMOJI);
		await tryReact(message, ERROR_EMOJI);
		throw err;
	}
}

const SKIDROW_TTL_MS = 15 * 60 * 1000;
const RECENT_IMAGE_TTL_MS = 10 * 60 * 1000;

/** Linha de botões 1..n p/ escolher o magnet (some quando não há hits). */
function magnetRow(n: number): ActionRowBuilder<ButtonBuilder>[] {
	if (n <= 0) return [];
	const row = new ActionRowBuilder<ButtonBuilder>();
	for (let i = 0; i < Math.min(n, 3); i++) {
		row.addComponents(
			new ButtonBuilder()
				.setCustomId(`skr:${i}`)
				.setLabel(`${i + 1}`)
				.setStyle(ButtonStyle.Primary),
		);
	}
	return [row];
}

export class DiscordGateway {
	private readonly client: Client;
	private readonly queues = new Map<string, Incoming[]>();
	private readonly running = new Set<string>();
	private readonly lastReply = new Map<string, number>();
	private readonly skidrowTop = new Map<string, { hits: SkidrowHit[]; at: number }>();
	private readonly channelImages = new Map<string, { urls: string[]; at: number }>();
	private botUserId = "";

	private readonly getSettings: () => BotSettings;
	private readonly respond: Respond;
	private readonly onReady: ((tag: string) => void) | undefined;
	private readonly emit: (msg: string, attrs?: Record<string, unknown>) => void;
	private readonly onCommand: CommandHandler | undefined;
	private readonly outboxDir: string | undefined;
	private readonly persist: ((m: PersistedMessage) => void) | undefined;

	constructor(
		getSettings: () => BotSettings,
		respond: Respond,
		client?: Client,
		onReady?: (tag: string) => void,
		emit: (msg: string, attrs?: Record<string, unknown>) => void = (m) => console.log(m),
		onCommand?: CommandHandler,
		outboxDir?: string,
		persist?: (m: PersistedMessage) => void,
	) {
		this.getSettings = getSettings;
		this.respond = respond;
		this.onReady = onReady;
		this.emit = emit;
		this.onCommand = onCommand;
		this.outboxDir = outboxDir;
		this.persist = persist;
		this.client =
			client ??
			new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					// Privileged: enable "Message Content Intent" in the dev portal (like the Go bot).
					GatewayIntentBits.MessageContent,
				],
			});
	}

	settings(): BotSettings {
		return this.getSettings();
	}

	/** Test hook: last reply timestamp per channel. */
	lastReplyAt(channelId: string): number {
		return this.lastReply.get(channelId) ?? 0;
	}

	/** Test hook: pending queue depth per channel. */
	queueDepth(channelId: string): number {
		return this.queues.get(channelId)?.length ?? 0;
	}

	async start(token: string): Promise<void> {
		this.client.once(Events.ClientReady, (c) => {
			this.botUserId = c.user.id;
			this.onReady?.(c.user.tag);
			void this.registerCommands();
		});
		this.client.on(Events.MessageCreate, (m) => {
			void this.onMessage(m as Message);
		});
		this.client.on(Events.InteractionCreate, (i) => {
			void this.onInteraction(i as Interaction);
		});
		await this.client.login(token);
	}

	/** Registra /lista na guild (instantâneo; global demoraria até 1h). */
	private async registerCommands(): Promise<void> {
		try {
			const guildId = this.getSettings().discord.guild_id;
			if (guildId) {
				const guild = await this.client.guilds.fetch(guildId);
				await guild.commands.set([LISTA_COMMAND_JSON]);
			} else {
				await this.client.application?.commands.set([LISTA_COMMAND_JSON]);
			}
			this.emit("slash commands registrados: /lista");
		} catch (err) {
			this.emit(`slash commands ERRO: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * Slash command /lista: lista o top 3 do Skidrow sem passar pelo LLM —
	 * por isso nunca cai na recusa anti-pirataria da soul/modelo.
	 * Os botões 1/2/3 trazem o magnet da opção (via cache do canal).
	 */
	async onInteraction(interaction: Interaction): Promise<void> {
		if (interaction.isButton()) {
			await this.onMagnetButton(interaction);
			return;
		}
		if (!interaction.isChatInputCommand() || interaction.commandName !== "lista") return;
		const settings = this.getSettings();
		const sameGuild = settings.discord.guild_id === "" || interaction.guildId === settings.discord.guild_id;
		if (!sameGuild || !settings.discord.channel_ids.includes(interaction.channelId)) {
			try {
				await interaction.reply({ content: "comando indisponível neste canal.", ephemeral: true });
			} catch {
				/* resposta efêmera nunca quebra o gateway */
			}
			return;
		}
		const jogo = interaction.options.getString("jogo", true).trim();
		try {
			// A busca leva segundos: defer primeiro (limite de 3s do Discord).
			await interaction.deferReply();
			const { text, hits, displayName, correctedFrom } = await searchSkidrow(jogo);
			try {
				this.persist?.({
					channelId: interaction.channelId,
					authorId: interaction.user.id,
					authorName: interaction.user.username,
					messageId: interaction.id,
					body: `/lista ${jogo}`,
				});
			} catch {
				/* histórico nunca quebra resposta */
			}
			if (hits.length > 0) this.rememberTop(interaction.channelId, hits);
			if (hits.length > 0) {
				await interaction.editReply({
					embeds: [listaEmbed(displayName, hits, correctedFrom)],
					components: magnetRow(hits.length),
				});
			} else {
				await interaction.editReply(text);
			}
		} catch (err) {
			try {
				const msg = `não rolou: ${err instanceof Error ? err.message : String(err)}`;
				if (interaction.deferred) await interaction.editReply(msg);
				else await interaction.reply({ content: msg, ephemeral: true });
			} catch {
				/* resposta nunca quebra o gateway */
			}
		}
	}

	/** Guarda URLs de imagem vistas no canal (memória visual curta, 10 min). */
	private rememberImageUrls(channelId: string, urls: string[]): void {
		const now = Date.now();
		for (const [id, e] of this.channelImages) {
			if (now - e.at > RECENT_IMAGE_TTL_MS) this.channelImages.delete(id);
		}
		if (urls.length === 0) return;
		const prev = this.channelImages.get(channelId)?.urls ?? [];
		const merged = [...prev, ...urls.filter((u) => !prev.includes(u))].slice(-MAX_VISION_IMAGES);
		this.channelImages.set(channelId, { urls: merged, at: now });
	}

	/** URLs recentes do canal (mais novas por último), vazias se expiradas. */
	private recentImageUrls(channelId: string): string[] {
		const e = this.channelImages.get(channelId);
		if (!e || Date.now() - e.at > RECENT_IMAGE_TTL_MS) {
			this.channelImages.delete(channelId);
			return [];
		}
		return e.urls;
	}

	/** Guarda o top 3 do canal p/ os botões 1/2/3 (expira em 15 min). */
	private rememberTop(channelId: string, hits: SkidrowHit[]): void {
		const now = Date.now();
		for (const [id, e] of this.skidrowTop) {
			if (now - e.at > SKIDROW_TTL_MS) this.skidrowTop.delete(id);
		}
		this.skidrowTop.set(channelId, { hits, at: now });
	}

	/** Botão 1/2/3: busca o magnet da opção no cache do canal. */
	private async onMagnetButton(interaction: Interaction): Promise<void> {
		if (!interaction.isButton() || !interaction.customId.startsWith("skr:")) return;
		const idx = Number(interaction.customId.slice(4));
		const entry = this.skidrowTop.get(interaction.channelId);
		const hit = entry && Date.now() - entry.at <= SKIDROW_TTL_MS ? entry.hits[idx] : undefined;
		if (!hit) {
			try {
				await interaction.reply({ content: "lista expirou — rode /lista de novo.", ephemeral: true });
			} catch {
				/* resposta efêmera nunca quebra o gateway */
			}
			return;
		}
		try {
			await interaction.deferReply();
			const magnet = await fetchMagnet(hit.url);
			try {
				this.persist?.({
					channelId: interaction.channelId,
					authorId: interaction.user.id,
					authorName: interaction.user.username,
					messageId: interaction.id,
					body: `magnet ${idx + 1}. ${hit.title}`,
				});
			} catch {
				/* histórico nunca quebra resposta */
			}
			await interaction.editReply(`${idx + 1}. ${hit.title}\n${magnet}`);
		} catch (err) {
			try {
				const msg = `não rolou: ${err instanceof Error ? err.message : String(err)}`;
				if (interaction.deferred) await interaction.editReply(msg);
				else await interaction.reply({ content: msg, ephemeral: true });
			} catch {
				/* resposta nunca quebra o gateway */
			}
		}
	}

	async stop(): Promise<void> {
		this.client.destroy();
		this.queues.clear();
		this.running.clear();
	}

	private async onMessage(message: Message): Promise<void> {
		const settings = this.getSettings();
		const eligible = isEligibleChannel(message, settings);
		this.emit(
			`msg canal=${message.channelId} autor=${message.author?.id} guild=${message.guildId} eligible=${eligible}`,
		);
		if (!eligible) return;
		const m = message as GuildMessage;
		// URLs primeiro (barato): próprias + mensagem respondida; download só se disparar.
		const direct = collectImageUrls(valuesOf(m.attachments), valuesOf(m.stickers));
		for (const u of await referencedImageUrls(m)) {
			if (direct.length >= MAX_VISION_IMAGES) break;
			if (!direct.includes(u)) direct.push(u);
		}
		this.rememberImageUrls(m.channelId, direct);
		try {
			this.persist?.({
				channelId: m.channelId,
				authorId: m.author.id,
				authorName: m.author.username,
				messageId: m.id,
				body: `${m.content ?? ""}${direct.length > 0 ? " [imagem]" : ""}`.slice(0, 4000),
				replyTo: m.reference?.messageId,
			});
		} catch {
			/* histórico nunca quebra resposta */
		}
		if ((m.content.startsWith("!") || m.content.startsWith("/")) && !m.author.bot) {
			try {
				const handled = await this.onCommand?.({
					channelId: m.channelId,
					authorId: m.author.id,
					text: m.content,
					reply: (t) => m.reply(t),
				});
				if (handled) return;
			} catch (err) {
				this.emit(`comando ERRO: ${err instanceof Error ? err.message : String(err)}`);
				return;
			}
		}
		const trigger = this.botUserId !== "" && isTrigger(m, this.botUserId);
		this.emit(`msg trigger=${trigger} mencoes=${m.mentions.users.size}`);
		if (!trigger) return;

		// Sem imagem própria: memória curta e, por último, histórico via API.
		const urls = [...direct];
		for (const u of this.recentImageUrls(m.channelId)) {
			if (urls.length >= MAX_VISION_IMAGES) break;
			if (!urls.includes(u)) urls.push(u);
		}
		if (urls.length === 0) {
			for (const u of await channelHistoryImageUrls(m)) {
				if (urls.length >= MAX_VISION_IMAGES) break;
				if (!urls.includes(u)) urls.push(u);
			}
		}
		const images = await downloadImages(urls).catch(() => [] as VisionImage[]);
		const text = m.content || (images.length > 0 ? "(imagem anexada)" : "");
		const incoming: Incoming = {
			message: m,
			channelId: m.channelId,
			authorId: m.author.id,
			text,
			images,
		};
		let queue = this.queues.get(m.channelId);
		if (!queue) {
			queue = [];
			this.queues.set(m.channelId, queue);
		}
		if (queue.length >= MAX_QUEUE) return; // full: drop (like the Go bot)
		queue.push(incoming);
		void this.pump(m.channelId);
	}

	private async pump(channelId: string): Promise<void> {
		if (this.running.has(channelId)) return;
		this.running.add(channelId);
		try {
			for (;;) {
				const queue = this.queues.get(channelId);
				const next = queue?.shift();
				if (!next) break;
				await this.replyOne(next);
			}
		} finally {
			this.running.delete(channelId);
		}
	}

	private async drainOutbox(incoming: Incoming): Promise<void> {
		if (!this.outboxDir) return;
		const files = await pendingAttachments(this.outboxDir, incoming.channelId);
		for (const file of files.slice(0, 3)) {
			try {
				await incoming.message.channel.send({ files: [{ attachment: file }] });
			} catch (err) {
				this.emit(`anexo ERRO canal=${incoming.channelId}: ${err instanceof Error ? err.message : String(err)}`);
				break;
			} finally {
				await discard(file);
			}
		}
	}

	private async replyOne(incoming: Incoming): Promise<void> {
		const settings = this.getSettings();
		const now = Date.now();
		const cooldown = settings.bot.reply_cooldown_ms;
		const elapsed = now - (this.lastReply.get(incoming.channelId) ?? 0);
		if (elapsed < cooldown) {
			await new Promise((r) => setTimeout(r, cooldown - elapsed));
		}
		try {
			const role = roleOf(incoming.authorId, settings);
			this.emit(`resposta canal=${incoming.channelId} role=${role} len=${incoming.text.length}`);
			const answer = await trackWorking(incoming.message, this.botUserId, () =>
				this.respond(incoming.channelId, incoming.authorId, incoming.text, incoming.images),
			);
			this.emit(`resposta ok canal=${incoming.channelId} len=${answer.length}`);
			this.lastReply.set(incoming.channelId, Date.now());
			const chunks = splitMessage(answer);
			let first = true;
			for (const chunk of chunks) {
				if (first) {
					await incoming.message.reply(chunk);
					first = false;
				} else {
					await incoming.message.channel.send(chunk);
				}
			}
			await this.drainOutbox(incoming);
		} catch (err) {
			await this.drainOutbox(incoming);
			this.emit(`resposta ERRO canal=${incoming.channelId}: ${err instanceof Error ? err.message : String(err)}`);
			await incoming.message
				.reply(`falhei aqui: ${err instanceof Error ? err.message : String(err)}`)
				.catch(() => undefined);
		}
	}
}
