/**
 * Adapter de entrada do Discord: traduz eventos do discord.js em chamadas aos
 * casos de uso. Regras (gatilho, fila, cooldown, busca de jogo) ficam fora.
 */

import {
	Client,
	Events,
	GatewayIntentBits,
	type Interaction,
	type Message,
	type OmitPartialGroupDMChannel,
} from "discord.js";
import type { DownloadImages } from "../../../application/download-images.ts";
import type { MessageLog } from "../../../application/message-log.ts";
import type { OutboxDelivery } from "../../../application/outbox-delivery.ts";
import type { Clock } from "../../../application/ports/clock.ts";
import type { ConfigStore } from "../../../application/ports/config-store.ts";
import type { Logger } from "../../../application/ports/logger.ts";
import type { ReplyToMessage } from "../../../application/reply-to-message.ts";
import type { SearchGames } from "../../../application/search-games.ts";
import type { TextCommands } from "../../../application/text-commands.ts";
import type { GameHit } from "../../../domain/game.ts";
import type { ImageData } from "../../../domain/image.ts";
import type { BotSettings } from "../../../domain/settings.ts";
import { type ChannelAccess, isAllowedChannel, shouldReply } from "../../../domain/trigger.ts";
import { collectImageUrls, type ImageCarrier, imagesOf, mergeUrls, valuesOf } from "./attachments.ts";
import { LISTA_COMMAND_JSON, listaEmbed, MAGNET_BUTTON_PREFIX, magnetRow } from "./lista.ts";
import { discordReplyTarget } from "./reply-target.ts";

type GuildMessage = OmitPartialGroupDMChannel<Message<boolean>>;

const LISTA_TTL_MS = 15 * 60 * 1000;
const RECENT_IMAGE_TTL_MS = 10 * 60 * 1000;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function channelAccess(settings: BotSettings): ChannelAccess {
	return { guildId: settings.discord.guild_id, channelIds: settings.discord.channel_ids };
}

export function isEligibleChannel(message: Message, settings: BotSettings): boolean {
	return isAllowedChannel({ guildId: message.guildId, channelId: message.channelId }, channelAccess(settings));
}

export function isTrigger(message: GuildMessage, botUserId: string): boolean {
	const refId = message.reference?.messageId;
	return shouldReply({
		fromBot: message.author.bot,
		fromSystem: message.author.system,
		viaWebhook: Boolean(message.webhookId),
		mentionsBot: message.mentions.has(botUserId),
		repliesToBot: refId ? message.channel.messages.cache.get(refId)?.author.id === botUserId : false,
	});
}

/** Mensagem respondida (reply com foto): falha isolada = sem imagem extra. */
async function referencedImageUrls(m: GuildMessage): Promise<string[]> {
	const refId = m.reference?.messageId;
	const fetch = (m.channel.messages as unknown as { fetch?: (id: string) => Promise<ImageCarrier> }).fetch;
	if (!refId || typeof fetch !== "function") return [];
	try {
		return imagesOf(await fetch.call(m.channel.messages, refId));
	} catch {
		return [];
	}
}

/** Fotos recentes do canal via API (sobrevive a restart). */
async function channelHistoryImageUrls(m: GuildMessage): Promise<string[]> {
	const fetch = (
		m.channel.messages as unknown as {
			fetch?: (opts: { limit: number }) => Promise<{ values(): Iterable<ImageCarrier> }>;
		}
	).fetch;
	if (typeof fetch !== "function") return [];
	let batch: { values(): Iterable<ImageCarrier> };
	try {
		batch = await fetch.call(m.channel.messages, { limit: 10 });
	} catch {
		return [];
	}
	const out: string[] = [];
	for (const msg of batch.values()) if (msg.id !== m.id) mergeUrls(out, imagesOf(msg));
	return out;
}

export interface GatewayDeps {
	config: ConfigStore;
	replies: ReplyToMessage;
	commands: TextCommands;
	games: SearchGames;
	images: DownloadImages;
	outbox: OutboxDelivery;
	history: MessageLog;
	logger: Logger;
	clock: Clock;
	client?: Client;
}

export class DiscordGateway {
	private readonly deps: GatewayDeps;
	private readonly client: Client;
	private readonly listaTop = new Map<string, { hits: GameHit[]; at: number }>();
	private readonly channelImages = new Map<string, { urls: string[]; at: number }>();
	private botUserId = "";

	constructor(deps: GatewayDeps) {
		this.deps = deps;
		this.client =
			deps.client ??
			new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					// Privilegiado: ligar "Message Content Intent" no portal de dev.
					GatewayIntentBits.MessageContent,
				],
			});
	}

	async start(token: string): Promise<void> {
		this.client.once(Events.ClientReady, (c) => {
			this.botUserId = c.user.id;
			this.deps.logger.info(`logado no Discord como ${c.user.tag}`);
			void this.registerCommands();
		});
		this.client.on(Events.MessageCreate, (m) => void this.onMessage(m as Message));
		this.client.on(Events.InteractionCreate, (i) => void this.onInteraction(i as Interaction));
		await this.client.login(token);
	}

	async stop(): Promise<void> {
		this.client.destroy();
	}

	/** /lista na guild (instantaneo; global demoraria ate 1h). */
	private async registerCommands(): Promise<void> {
		try {
			const guildId = this.deps.config.all().discord.guild_id;
			if (guildId) await (await this.client.guilds.fetch(guildId)).commands.set([LISTA_COMMAND_JSON]);
			else await this.client.application?.commands.set([LISTA_COMMAND_JSON]);
			this.deps.logger.info("slash commands registrados: /lista");
		} catch (err) {
			this.deps.logger.error(`slash commands ERRO: ${errorText(err)}`);
		}
	}

	/** /lista sem LLM (nunca cai em recusa do modelo) + botoes 1/2/3 com o magnet. */
	async onInteraction(interaction: Interaction): Promise<void> {
		if (interaction.isButton()) {
			await this.onMagnetButton(interaction);
			return;
		}
		if (!interaction.isChatInputCommand() || interaction.commandName !== "lista") return;
		const place = { guildId: interaction.guildId, channelId: interaction.channelId };
		if (!isAllowedChannel(place, channelAccess(this.deps.config.all()))) {
			await interaction.reply({ content: "comando indisponível neste canal.", ephemeral: true }).catch(() => undefined);
			return;
		}
		const jogo = interaction.options.getString("jogo", true).trim();
		try {
			// A busca leva segundos: defer primeiro (limite de 3s do Discord).
			await interaction.deferReply();
			const found = await this.deps.games.search(jogo);
			this.deps.history.record({
				channelId: interaction.channelId,
				authorId: interaction.user.id,
				authorName: interaction.user.username,
				messageId: interaction.id,
				body: `/lista ${jogo}`,
			});
			if (found.hits.length === 0) {
				await interaction.editReply(found.text);
				return;
			}
			this.remember(this.listaTop, interaction.channelId, { hits: found.hits }, LISTA_TTL_MS);
			await interaction.editReply({
				embeds: [listaEmbed(found.displayName, found.hits, found.correctedFrom)],
				components: magnetRow(found.hits.length),
			});
		} catch (err) {
			const msg = `não rolou: ${errorText(err)}`;
			if (interaction.deferred) await interaction.editReply(msg).catch(() => undefined);
			else await interaction.reply({ content: msg, ephemeral: true }).catch(() => undefined);
		}
	}

	private async onMagnetButton(interaction: Interaction): Promise<void> {
		if (!interaction.isButton() || !interaction.customId.startsWith(MAGNET_BUTTON_PREFIX)) return;
		const idx = Number(interaction.customId.slice(MAGNET_BUTTON_PREFIX.length));
		const hit = this.fresh(this.listaTop, interaction.channelId, LISTA_TTL_MS)?.hits[idx];
		if (!hit) {
			await interaction.reply({ content: "lista expirou — rode /lista de novo.", ephemeral: true }).catch(() => undefined);
			return;
		}
		try {
			await interaction.deferReply();
			const magnet = await this.deps.games.magnet(hit.url);
			this.deps.history.record({
				channelId: interaction.channelId,
				authorId: interaction.user.id,
				authorName: interaction.user.username,
				messageId: interaction.id,
				body: `magnet ${idx + 1}. ${hit.title}`,
			});
			await interaction.editReply(`${idx + 1}. ${hit.title}\n${magnet}`);
		} catch (err) {
			const msg = `não rolou: ${errorText(err)}`;
			if (interaction.deferred) await interaction.editReply(msg).catch(() => undefined);
			else await interaction.reply({ content: msg, ephemeral: true }).catch(() => undefined);
		}
	}

	private async onMessage(message: Message): Promise<void> {
		const { config, logger, history, commands, replies, images } = this.deps;
		const eligible = isEligibleChannel(message, config.all());
		logger.info(`msg canal=${message.channelId} autor=${message.author?.id} guild=${message.guildId} eligible=${eligible}`);
		if (!eligible) return;
		const m = message as GuildMessage;
		// URLs primeiro (barato): propria + respondida; download so se disparar.
		const direct = mergeUrls(collectImageUrls(valuesOf(m.attachments), valuesOf(m.stickers)), await referencedImageUrls(m));
		this.rememberImages(m.channelId, direct);
		// Apelido no servidor > nome global > username; mencoes como @nome (nao <@id>).
		const authorName = m.member?.displayName ?? m.author.globalName ?? m.author.username;
		const content = m.cleanContent;
		history.record({
			channelId: m.channelId,
			authorId: m.author.id,
			authorName,
			messageId: m.id,
			body: `${content}${direct.length > 0 ? " [imagem]" : ""}`,
			replyTo: m.reference?.messageId,
			fromBot: m.author.bot,
		});
		if (!m.author.bot && (m.content.startsWith("!") || m.content.startsWith("/"))) {
			try {
				const answer = await commands.handle({ channelId: m.channelId, authorId: m.author.id, text: m.content });
				if (answer !== null) {
					await m.reply(answer);
					return;
				}
			} catch (err) {
				logger.error(`comando ERRO: ${errorText(err)}`);
				return;
			}
		}
		const trigger = this.botUserId !== "" && isTrigger(m, this.botUserId);
		logger.info(`msg trigger=${trigger} mencoes=${m.mentions.users.size}`);
		if (!trigger) return;
		// Sem imagem propria: memoria curta do canal e, por ultimo, historico via API.
		const urls = mergeUrls([...direct], this.fresh(this.channelImages, m.channelId, RECENT_IMAGE_TTL_MS)?.urls ?? []);
		if (urls.length === 0) mergeUrls(urls, await channelHistoryImageUrls(m));
		const downloaded: ImageData[] = await images.run(urls).catch(() => []);
		const text = content || (downloaded.length > 0 ? "(imagem anexada)" : "");
		const target = discordReplyTarget(m, this.botUserId, () =>
			this.deps.outbox.deliver(m.channelId, async (path) => {
				await m.channel.send({ files: [{ attachment: path }] });
			}),
		);
		const incoming = { channelId: m.channelId, authorId: m.author.id, authorName, messageId: m.id, text, images: downloaded };
		if (!replies.submit(incoming, target)) {
			logger.warn(`fila cheia canal=${m.channelId}: mensagem descartada`);
		}
	}

	/** Memoria visual curta do canal (ultimas imagens, 10 min). */
	private rememberImages(channelId: string, urls: string[]): void {
		if (urls.length === 0) {
			this.fresh(this.channelImages, channelId, RECENT_IMAGE_TTL_MS);
			return;
		}
		const prev = this.fresh(this.channelImages, channelId, RECENT_IMAGE_TTL_MS)?.urls ?? [];
		const merged = [...prev, ...urls.filter((u) => !prev.includes(u))].slice(-3);
		this.remember(this.channelImages, channelId, { urls: merged }, RECENT_IMAGE_TTL_MS);
	}

	private remember<T extends object>(cache: Map<string, T & { at: number }>, key: string, value: T, ttlMs: number): void {
		const now = this.deps.clock.now();
		for (const [k, e] of cache) if (now - e.at > ttlMs) cache.delete(k);
		cache.set(key, { ...value, at: now });
	}

	private fresh<T extends { at: number }>(cache: Map<string, T>, key: string, ttlMs: number): T | undefined {
		const e = cache.get(key);
		if (e && this.deps.clock.now() - e.at <= ttlMs) return e;
		cache.delete(key);
		return undefined;
	}
}
