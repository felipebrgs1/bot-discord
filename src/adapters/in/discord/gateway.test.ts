import { describe, expect, it, vi } from "bun:test";
import { DownloadImages } from "../../../application/download-images.ts";
import { MessageLog } from "../../../application/message-log.ts";
import { OutboxDelivery } from "../../../application/outbox-delivery.ts";
import type { ChatRequest } from "../../../application/ports/chat-agent.ts";
import type { GameCatalog } from "../../../application/ports/game-catalog.ts";
import { ReplyToMessage } from "../../../application/reply-to-message.ts";
import { SearchGames } from "../../../application/search-games.ts";
import { TextCommands } from "../../../application/text-commands.ts";
import { defaultSettings } from "../../../domain/settings.ts";
import { FakeClock } from "../../../test-support/fakes/clock.ts";
import { FakeConfigStore } from "../../../test-support/fakes/config-store.ts";
import { FakeLogger } from "../../../test-support/fakes/logger.ts";
import { FakeMessageStore } from "../../../test-support/fakes/message-store.ts";
import { FakeOutbox } from "../../../test-support/fakes/outbox.ts";
import { type FakeRoute, FakePageFetcher } from "../../../test-support/fakes/page-fetcher.ts";
import { FakeSoulStore } from "../../../test-support/fakes/soul-store.ts";
import { DiscordGateway, isEligibleChannel, isTrigger } from "./gateway.ts";

const PNG: [RegExp, FakeRoute] = [/./, { contentType: "image/png", body: "IMG" }];

const catalog: GameCatalog = {
	search: async (name) => {
		if (name === "boom") throw new Error("rede caiu");
		return {
			hits: [
				{ title: "Forza Horizon 6-RUNE", url: "https://skidrow/fh6/", cover: "https://skidrow/fh6.jpg" },
				{ title: "Forza Horizon 5-P2P", url: "https://skidrow/fh5/" },
			],
			searchUrl: "https://skidrow/?s=x",
		};
	},
	correctName: async () => null,
	magnet: async () => "magnet:?xt=urn:btih:HASH123",
};

function setup(opts: { routes?: [RegExp, FakeRoute][]; guild?: string } = {}) {
	const clock = new FakeClock(0);
	const logger = new FakeLogger();
	const config = new FakeConfigStore({ discord: { guild_id: opts.guild ?? "g1", channel_ids: ["c1"], admin_ids: ["dono"] } });
	const asked: ChatRequest[] = [];
	const replies = new ReplyToMessage({
		agent: {
			ask: async (r) => {
				asked.push(r);
				return "vi";
			},
		},
		clock,
		logger,
		settings: () => ({ cooldownMs: 0, adminIds: [] }),
		systemPromptFor: () => "",
	});
	const messages = new FakeMessageStore();
	const outbox = new FakeOutbox();
	const games = new SearchGames(catalog);
	const souls = new FakeSoulStore();
	souls.ensureSeed("padrão");
	const handlers: Record<string, (m: unknown) => void> = {};
	const client = {
		once: () => undefined,
		on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
		login: async () => undefined,
		destroy: () => undefined,
	};
	const gw = new DiscordGateway({
		config,
		replies,
		commands: new TextCommands({ games, souls, sessions: { conversations: () => [], forget: () => undefined }, adminIds: () => ["dono"] }),
		games,
		images: new DownloadImages(new FakePageFetcher(opts.routes ?? [PNG])),
		outbox: new OutboxDelivery(outbox, logger),
		history: new MessageLog(messages, logger),
		logger,
		clock,
		client: client as never,
	});
	(gw as unknown as { botUserId: string }).botUserId = "bot";
	void gw.start("tok");
	/** Dispara messageCreate e espera o gateway e a fila de respostas terminarem. */
	const receive = async (m: Record<string, unknown>) => {
		handlers["messageCreate"]?.(m);
		await new Promise((r) => setTimeout(r, 10));
		await replies.idle();
	};
	return { gw, clock, asked, messages, outbox, receive };
}

function message(over: Record<string, unknown> = {}) {
	const events: string[] = [];
	const m = {
		id: "m1",
		guildId: "g1",
		channelId: "c1",
		author: { id: "u1", username: "ana", bot: false, system: false },
		webhookId: null,
		content: "oi",
		mentions: { users: { size: 0 }, has: () => false },
		reference: undefined,
		attachments: new Map(),
		stickers: new Map(),
		reply: vi.fn(async (c: unknown) => void events.push(`reply ${String(c)}`)),
		react: vi.fn(async () => undefined),
		reactions: { cache: new Map() },
		channel: {
			messages: { cache: new Map() },
			send: vi.fn(async (c: { files?: { attachment: string }[] }) => void events.push(`send ${c.files?.[0]?.attachment ?? String(c)}`)),
			sendTyping: vi.fn(async () => undefined),
		},
		...over,
	};
	return { m, events };
}

const mentioned = { mentions: { users: { size: 1 }, has: () => true } };
const photo = (url: string) => ({ attachments: new Map([["a1", { contentType: "image/png", url }]]) });

describe("isEligibleChannel / isTrigger", () => {
	const settings = { ...defaultSettings(), discord: { guild_id: "g1", channel_ids: ["c1"], admin_ids: [] } };

	it("so canal da allowlist na guild", () => {
		expect(isEligibleChannel(message().m as never, settings)).toBe(true);
		expect(isEligibleChannel(message({ guildId: null }).m as never, settings)).toBe(false);
		expect(isEligibleChannel(message({ guildId: "outra" }).m as never, settings)).toBe(false);
		expect(isEligibleChannel(message({ channelId: "c9" }).m as never, settings)).toBe(false);
	});

	it("mencao ou reply ao bot disparam; bot, webhook e conversa nao", () => {
		expect(isTrigger(message(mentioned).m as never, "bot")).toBe(true);
		expect(isTrigger(message({ ...mentioned, author: { id: "b", bot: true } }).m as never, "bot")).toBe(false);
		expect(isTrigger(message({ ...mentioned, webhookId: "w" }).m as never, "bot")).toBe(false);
		expect(isTrigger(message().m as never, "bot")).toBe(false);
		const cache = new Map([["m0", { author: { id: "bot" } }]]);
		const reply = (id: string) => message({ reference: { messageId: id }, channel: { messages: { cache } } }).m;
		expect(isTrigger(reply("m0") as never, "bot")).toBe(true);
		expect(isTrigger(reply("zz") as never, "bot")).toBe(false);
	});
});

describe("mensagem", () => {
	it("mencao vira pergunta ao agente e a resposta volta como reply", async () => {
		const { asked, receive } = setup();
		const { m, events } = message({ ...mentioned, content: "tudo bem?" });
		await receive(m);
		expect(asked.map((r) => [r.channelId, r.authorId, r.text])).toEqual([["c1", "u1", "tudo bem?"]]);
		expect(events).toEqual(["reply vi"]);
	});

	it("mensagem de bot vai pro historico marcada como de bot", async () => {
		const { messages, receive } = setup();
		await receive(message({ id: "m8", author: { id: "b1", username: "outro", bot: true, system: false } }).m);
		await receive(message({ id: "m9" }).m);
		expect(messages.messages.map((x) => [x.messageId, x.fromBot])).toEqual([
			["m8", true],
			["m9", false],
		]);
	});

	it("toda mensagem elegivel vai pro historico, com marca de imagem", async () => {
		const { messages, receive } = setup();
		await receive(message({ id: "m7", content: "olha", reference: { messageId: "m6" }, ...photo("https://cdn/a.png") }).m);
		expect(messages.messages.map((x) => [x.messageId, x.body, x.replyTo])).toEqual([["m7", "olha [imagem]", "m6"]]);
	});

	it("canal fora da allowlist e ignorado por inteiro", async () => {
		const { asked, messages, receive } = setup();
		await receive(message({ ...mentioned, channelId: "c9" }).m);
		expect(asked).toEqual([]);
		expect(messages.messages).toEqual([]);
	});

	it("anexo de imagem chega ao agente em base64", async () => {
		const { asked, receive } = setup();
		await receive(message({ ...mentioned, content: "", ...photo("https://cdn/foto.png") }).m);
		expect(asked[0]?.text).toBe("(imagem anexada)");
		expect(asked[0]?.images).toEqual([{ data: Buffer.from("IMG").toString("base64"), mimeType: "image/png" }]);
	});

	it("pergunta sem anexo usa a foto recente do canal; com mais de 10 min, nao", async () => {
		const { asked, clock, receive } = setup();
		await receive(message({ id: "m20", content: "", ...photo("https://cdn/foto.png") }).m);
		expect(asked).toEqual([]);
		await receive(message({ id: "m21", ...mentioned, content: "quem é?" }).m);
		expect(asked[0]?.images).toHaveLength(1);
		clock.advance(10 * 60 * 1000 + 1);
		await receive(message({ id: "m22", ...mentioned, content: "e agora?" }).m);
		expect(asked[1]?.images).toEqual([]);
	});

	it("memoria vazia (pos-restart) busca foto no historico do canal", async () => {
		const { asked, receive } = setup();
		const history = new Map([["m30", { id: "m30", ...photo("https://cdn/antiga.png"), stickers: new Map(), embeds: [] }]]);
		const { m } = message({ id: "m31", ...mentioned, content: "quem é?" });
		m.channel = { ...m.channel, messages: { cache: new Map(), fetch: async () => history } } as never;
		await receive(m);
		expect(asked[0]?.images).toHaveLength(1);
	});

	it("reply numa foto: a propria e a respondida chegam", async () => {
		const { asked, receive } = setup();
		const ref = { ...photo("https://cdn/ref.jpg"), stickers: new Map(), embeds: [] };
		const { m } = message({ ...mentioned, reference: { messageId: "m0" }, ...photo("https://cdn/minha.png") });
		m.channel = { ...m.channel, messages: { cache: new Map(), fetch: async () => ref } } as never;
		await receive(m);
		expect(asked[0]?.images).toHaveLength(2);
	});

	it("arquivo que a tool largou no outbox vai depois da resposta e e descartado", async () => {
		const { outbox, receive } = setup();
		outbox.put("c1", "v.mp4");
		const { m, events } = message(mentioned);
		await receive(m);
		expect(events).toEqual(["reply vi", "send /outbox/c1/v.mp4"]);
		expect(outbox.discarded).toEqual(["/outbox/c1/v.mp4"]);
	});

	it("comando de texto responde direto, sem agente", async () => {
		const { asked, receive } = setup();
		const { m, events } = message({ ...mentioned, content: "!lista forza" });
		await receive(m);
		expect(events).toEqual(["reply 1. Forza Horizon 6-RUNE\nhttps://skidrow/fh6/\n2. Forza Horizon 5-P2P\nhttps://skidrow/fh5/"]);
		expect(asked).toEqual([]);
	});

	it("!algo que nao e comando segue para o agente se mencionar", async () => {
		const { asked, receive } = setup();
		await receive(message({ ...mentioned, content: "!oi" }).m);
		expect(asked).toHaveLength(1);
	});
});

function interaction(over: Record<string, unknown> = {}) {
	const ix = {
		commandName: "lista",
		isChatInputCommand: () => true,
		isButton: () => false,
		customId: "",
		guildId: "g1",
		channelId: "c1",
		id: "i1",
		user: { id: "u1", username: "ana" },
		options: { getString: () => "forza horizon" },
		deferred: false,
		reply: vi.fn(async (_payload: unknown) => undefined),
		deferReply: vi.fn(async () => {
			ix.deferred = true;
		}),
		editReply: vi.fn(async (_payload: unknown) => undefined),
		...over,
	};
	return ix;
}

const button = (idx: number) =>
	interaction({ commandName: undefined, isChatInputCommand: () => false, isButton: () => true, customId: `skr:${idx}`, id: "i2" });

describe("/lista", () => {
	it("responde embed com top e botoes, sem agente, e registra no historico", async () => {
		const { gw, asked, messages } = setup();
		const ix = interaction();
		await gw.onInteraction(ix as never);
		expect(ix.deferReply).toHaveBeenCalledTimes(1);
		const payload = ix.editReply.mock.calls[0]?.[0] as unknown as { embeds: { toJSON(): { title?: string; fields?: unknown[] } }[]; components: unknown[] };
		expect(payload.embeds[0]?.toJSON().title).toBe("🎮 forza horizon");
		expect(payload.embeds[0]?.toJSON().fields).toHaveLength(2);
		expect(payload.components).toHaveLength(1);
		expect(asked).toEqual([]);
		expect(messages.messages.map((m) => m.body)).toEqual(["/lista forza horizon"]);
	});

	it("falha na busca edita com erro", async () => {
		const { gw } = setup();
		const ix = interaction({ options: { getString: () => "boom" } });
		await gw.onInteraction(ix as never);
		expect(String(ix.editReply.mock.calls[0]?.[0])).toBe("não rolou: rede caiu");
	});

	it("botao traz o magnet da opcao da lista do canal", async () => {
		const { gw } = setup();
		await gw.onInteraction(interaction() as never);
		const btn = button(0);
		await gw.onInteraction(btn as never);
		expect(String(btn.editReply.mock.calls[0]?.[0])).toBe("1. Forza Horizon 6-RUNE\nmagnet:?xt=urn:btih:HASH123");
	});

	it("botao sem lista (ou lista vencida) recebe efemero", async () => {
		const { gw, clock } = setup();
		const early = button(1);
		await gw.onInteraction(early as never);
		expect(early.reply.mock.calls[0]?.[0]).toMatchObject({ ephemeral: true });
		await gw.onInteraction(interaction() as never);
		clock.advance(15 * 60 * 1000 + 1);
		const late = button(0);
		await gw.onInteraction(late as never);
		expect(late.reply.mock.calls[0]?.[0]).toMatchObject({ content: "lista expirou — rode /lista de novo." });
	});

	it("canal fora da allowlist e DM recebem efemero sem buscar", async () => {
		const { gw } = setup({ guild: "" });
		for (const over of [{ channelId: "c9" }, { guildId: null }]) {
			const ix = interaction(over);
			await gw.onInteraction(ix as never);
			expect(ix.deferReply).not.toHaveBeenCalled();
			expect(ix.reply.mock.calls[0]?.[0]).toMatchObject({ ephemeral: true });
		}
	});

	it("ignora outro comando", async () => {
		const { gw } = setup();
		const ix = interaction({ commandName: "outro" });
		await gw.onInteraction(ix as never);
		expect(ix.reply).not.toHaveBeenCalled();
		expect(ix.deferReply).not.toHaveBeenCalled();
	});
});
