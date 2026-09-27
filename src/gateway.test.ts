import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "bun:test";
import { replaceFetch, restoreFetch } from "./test-support/stub-fetch.ts";
import { FakeClock } from "./test-support/fakes/clock.ts";
import { DEFAULTS } from "./config.ts";
import { ReplyToMessage } from "./application/reply-to-message.ts";
import type { ImageData } from "./domain/image.ts";
import { DiscordGateway, discordReplyTarget, type GatewayOptions, isEligibleChannel, isTrigger } from "./gateway.ts";
import { FakeLogger } from "./test-support/fakes/logger.ts";

const settings = () => ({
	...DEFAULTS,
	discord: { guild_id: "g1", channel_ids: ["c1"], admin_ids: [] },
	bot: { ...DEFAULTS.bot, reply_cooldown_ms: 0 },
});

type Respond = (channelId: string, authorId: string, text: string, images: ImageData[]) => Promise<string>;

/** Gateway com o caso de uso real e um ChatAgent que chama `respond`. */
function makeGateway(respond: Respond, over: Partial<GatewayOptions> = {}): DiscordGateway {
	const clock = over.clock ?? new FakeClock(0);
	const replies = new ReplyToMessage({
		agent: { ask: (r) => respond(r.channelId, r.authorId, r.text, [...r.images]) },
		clock,
		logger: new FakeLogger(),
		settings: () => ({ cooldownMs: 0, adminIds: [] }),
	});
	return new DiscordGateway({ settings, replies, emit: () => undefined, clock, ...over });
}

function message(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		guildId: "g1",
		channelId: "c1",
		author: { id: "u1", username: "ana", bot: false, system: false },
		webhookId: null,
		content: "oi",
		mentions: { users: { size: 0 }, has: () => false },
		reference: undefined,
		channel: { messages: { cache: new Map() } },
		...over,
	};
}

describe("onMessage com imagem", () => {
	it("anexo de imagem chega ao respond como base64", async () => {
		replaceFetch(vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
				arrayBuffer: async () => new TextEncoder().encode("IMG").buffer as ArrayBuffer,
			})),
		);
		try {
			const seen: { text: string; images?: { data: string; mimeType: string }[] }[] = [];
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async (_c, _a, text, images) => {
					seen.push({ text, images });
					return "vi";
				}, { client: client as never });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const msg = message({
				id: "m9",
				content: "",
				mentions: { users: { size: 1 }, has: () => true },
				attachments: new Map([["a1", { contentType: "image/png", size: 3, url: "https://cdn/foto.png" }]]),
				stickers: new Map(),
				reply: vi.fn(async () => undefined),
				react: vi.fn(async () => undefined),
				reactions: { cache: new Map() },
				channel: {
					messages: { cache: new Map() },
					send: vi.fn(async () => undefined),
					sendTyping: vi.fn(async () => undefined),
				},
			});
			handlers["messageCreate"]?.(msg);
			await new Promise((r) => setTimeout(r, 100));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.text).toBe("(imagem anexada)");
			expect(seen[0]?.images).toHaveLength(1);
			expect(seen[0]?.images?.[0]?.mimeType).toBe("image/png");
			expect(seen[0]?.images?.[0]?.data).toBe(Buffer.from("IMG").toString("base64"));
			await gw.stop();
		} finally {
			restoreFetch();
		}
	});
});

describe("onMessage com foto anterior no canal", () => {
	it("pergunta sem anexo usa a imagem recente do canal", async () => {
		replaceFetch(vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
				arrayBuffer: async () => new TextEncoder().encode("IMG").buffer as ArrayBuffer,
			})),
		);
		try {
			const seen: { text: string; images?: { data: string }[] }[] = [];
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async (_c, _a, text, images) => {
					seen.push({ text, images });
					return "vi";
				}, { client: client as never });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const base = {
				reply: vi.fn(async () => undefined),
				react: vi.fn(async () => undefined),
				reactions: { cache: new Map() },
				channel: {
					messages: { cache: new Map() },
					send: vi.fn(async () => undefined),
					sendTyping: vi.fn(async () => undefined),
				},
			};
			// Foto sem mencionar: não dispara, mas entra na memória do canal.
			handlers["messageCreate"]?.(
				message({
					id: "m20",
					content: "",
					attachments: new Map([["a1", { contentType: "image/png", size: 3, url: "https://cdn/foto.png" }]]),
					stickers: new Map(),
					...base,
				}),
			);
			await new Promise((r) => setTimeout(r, 50));
			expect(seen).toHaveLength(0);
			// Pergunta mencionando, sem anexo: enxerga a foto anterior.
			handlers["messageCreate"]?.(
				message({
					id: "m21",
					content: "quem ta nessa foto",
					mentions: { users: { size: 1 }, has: () => true },
					attachments: new Map(),
					stickers: new Map(),
					...base,
				}),
			);
			await new Promise((r) => setTimeout(r, 100));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.text).toBe("quem ta nessa foto");
			expect(seen[0]?.images).toHaveLength(1);
			await gw.stop();
		} finally {
			restoreFetch();
		}
	});
});

describe("onMessage com foto antiga no histórico", () => {
	it("memória vazia (pós-restart) busca foto via API do canal", async () => {
		replaceFetch(vi.fn(async () => ({
				ok: true,
				status: 200,
				headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
				arrayBuffer: async () => new TextEncoder().encode("IMG").buffer as ArrayBuffer,
			})),
		);
		try {
			const seen: { images?: { data: string }[] }[] = [];
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async (_c, _a, _t, images) => {
					seen.push({ images });
					return "vi";
				}, { client: client as never });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const history = new Map([
				[
					"m30",
					{
						id: "m30",
						attachments: new Map([["a1", { contentType: "image/png", size: 3, url: "https://cdn/antiga.png" }]]),
						stickers: new Map(),
						embeds: [],
					},
				],
			]);
			const base = {
				reply: vi.fn(async () => undefined),
				react: vi.fn(async () => undefined),
				reactions: { cache: new Map() },
				channel: {
					messages: { cache: new Map(), fetch: async () => history },
					send: vi.fn(async () => undefined),
					sendTyping: vi.fn(async () => undefined),
				},
			};
			handlers["messageCreate"]?.(
				message({
					id: "m31",
					content: "quem ta nessa foto",
					mentions: { users: { size: 1 }, has: () => true },
					attachments: new Map(),
					stickers: new Map(),
					...base,
				}),
			);
			await new Promise((r) => setTimeout(r, 100));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.images).toHaveLength(1);
			await gw.stop();
		} finally {
			restoreFetch();
		}
	});
});

describe("onMessage com reply em imagem", () => {
	it("foto da mensagem respondida também chega ao respond", async () => {
		replaceFetch(vi.fn(async (url: unknown) => ({
				ok: true,
				status: 200,
				headers: { get: (h: string) => (h === "content-type" ? "image/jpeg" : null) },
				arrayBuffer: async () => new TextEncoder().encode(`bytes-de-${String(url)}`).buffer as ArrayBuffer,
			})),
		);
		try {
			const seen: { images?: { data: string }[] }[] = [];
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async (_c, _a, _t, images) => {
					seen.push({ images });
					return "vi";
				}, { client: client as never });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const refMsg = {
				attachments: new Map([["r1", { contentType: "image/jpeg", size: 5, url: "https://cdn/ref.jpg" }]]),
				stickers: new Map(),
				embeds: [],
			};
			const msg = message({
				id: "m10",
				content: "olha isso",
				mentions: { users: { size: 1 }, has: () => true },
				reference: { messageId: "m0" },
				attachments: new Map([["a1", { contentType: "image/png", size: 3, url: "https://cdn/minha.png" }]]),
				stickers: new Map(),
				reply: vi.fn(async () => undefined),
				react: vi.fn(async () => undefined),
				reactions: { cache: new Map() },
				channel: {
					messages: { cache: new Map(), fetch: async () => refMsg },
					send: vi.fn(async () => undefined),
					sendTyping: vi.fn(async () => undefined),
				},
			});
			handlers["messageCreate"]?.(msg);
			await new Promise((r) => setTimeout(r, 100));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.images).toHaveLength(2); // própria + respondida
			await gw.stop();
		} finally {
			restoreFetch();
		}
	});
});

describe("isEligibleChannel", () => {
	it("só canal allowlist de guild (DM/bot fora)", () => {
		expect(isEligibleChannel(message() as never, settings())).toBe(true);
		expect(isEligibleChannel(message({ guildId: null }) as never, settings())).toBe(false);
		expect(isEligibleChannel(message({ guildId: "outra" }) as never, settings())).toBe(false);
		expect(isEligibleChannel(message({ channelId: "c9" }) as never, settings())).toBe(false);
	});
});

describe("isTrigger", () => {
	it("menção dispara; bot/webhook/silêncio não", () => {
		const mentioned = message({ mentions: { users: { size: 1 }, has: () => true } });
		expect(isTrigger(mentioned as never, "bot")).toBe(true);
		expect(isTrigger(message({ author: { id: "b", bot: true } }) as never, "bot")).toBe(false);
		expect(isTrigger(message({ webhookId: "w" }) as never, "bot")).toBe(false);
		expect(isTrigger(message() as never, "bot")).toBe(false);
	});

	it("resposta a mensagem do bot dispara", () => {
		const cache = new Map([["m0", { author: { id: "bot" } }]]);
		const m = message({ reference: { messageId: "m0" }, channel: { messages: { cache } } });
		expect(isTrigger(m as never, "bot")).toBe(true);
		const m2 = message({ reference: { messageId: "zz" }, channel: { messages: { cache } } });
		expect(isTrigger(m2 as never, "bot")).toBe(false);
	});
});

const stubFetch = (routes: [RegExp, { status?: number; body: string }][]) =>
	vi.fn(async (url: unknown) => {
		const u = String(url);
		for (const [re, r] of routes) {
			if (re.test(u)) {
				return {
					ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
					status: r.status ?? 200,
					arrayBuffer: async () => new TextEncoder().encode(r.body).buffer as ArrayBuffer,
					json: async () => JSON.parse(r.body),
				};
			}
		}
		throw new Error(`rota não mockada: ${u}`);
	});

const SKIDROW_IX_HTML = `<html><body><h2>2 search results</h2>
<img decoding="async" class="aligncenter" src="https://www.skidrowreloaded.com/wp-content/uploads/fh6.jpg" alt="Forza Horizon 6-RUNE" />
<h2><a href="https://www.skidrowreloaded.com/forza-horizon-6-rune/">Forza Horizon 6-RUNE</a></h2>
<h2><a href="https://www.skidrowreloaded.com/forza-horizon-5-p2p/">Forza Horizon 5-P2P</a></h2>
</body></html>`;

type FnMock = ReturnType<typeof vi.fn>;
interface StubInteraction {
	[key: string]: unknown;
	reply: FnMock;
	deferReply: FnMock;
	editReply: FnMock;
	deferred: boolean;
}

function stubInteraction(over: Record<string, unknown> = {}): StubInteraction {
	const ix: StubInteraction = {
		commandName: "lista",
		isChatInputCommand: () => true,
		isButton: () => false,
		customId: "",
		guildId: "g1",
		channelId: "c1",
		id: "i1",
		user: { id: "u1", username: "ana" },
		options: { getString: () => "forza horizon" },
		reply: vi.fn(async () => undefined),
		deferred: false,
		deferReply: vi.fn(async () => {
			ix.deferred = true;
		}),
		editReply: vi.fn(async () => undefined),
		...over,
	};
	return ix;
}

describe("onInteraction (/lista)", () => {
	it("responde top 3, sem LLM", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		replaceFetch(vi.fn(async () => ({
				ok: true,
				status: 200,
				arrayBuffer: async () => new TextEncoder().encode(SKIDROW_IX_HTML).buffer as ArrayBuffer,
			})),
		);
		try {
			const persisted: unknown[] = [];
			const gw = makeGateway(async () => {
					throw new Error("LLM não deveria ser chamado");
				}, { persist: (m) => void persisted.push(m) });
			const ix = stubInteraction();
			await gw.onInteraction(ix as never);
			expect(ix.deferReply as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
			const edit = ix.editReply as ReturnType<typeof vi.fn>;
			expect(edit).toHaveBeenCalledTimes(1);
			const payload = edit.mock.calls[0]?.[0] as {
				embeds?: { toJSON(): Record<string, unknown> }[];
				components?: unknown[];
			};
			const embed = payload.embeds?.[0]?.toJSON() as Record<string, unknown>;
			expect(embed["title"]).toBe("🎮 forza horizon");
			expect(embed["image"]).toMatchObject({
				url: "https://www.skidrowreloaded.com/wp-content/uploads/fh6.jpg",
			});
			const fields = embed["fields"] as { name: string; value: string }[];
			expect(fields).toHaveLength(2);
			expect(fields[0]?.name).toContain("Forza Horizon 6-RUNE");
			expect(fields[0]?.value).toBe("[🔗 Ver página](https://www.skidrowreloaded.com/forza-horizon-6-rune/)");
			expect(payload.components).toHaveLength(1);
			expect(persisted).toHaveLength(1);
		} finally {
			restoreFetch();
			delete process.env["AGENT_ALLOW_PRIVATE"];
		}
	});

	it("falha na busca edita com erro", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		replaceFetch(vi.fn(async () => {
				throw new Error("rede caiu");
			}),
		);
		try {
			const gw = makeGateway(async () => "ok");
			const ix = stubInteraction();
			await gw.onInteraction(ix as never);
			const edit = ix.editReply as ReturnType<typeof vi.fn>;
			expect(edit).toHaveBeenCalledTimes(1);
			expect(String(edit.mock.calls[0]?.[0])).toContain("não rolou");
		} finally {
			restoreFetch();
			delete process.env["AGENT_ALLOW_PRIVATE"];
		}
	});

	it("botão 1 traz o magnet da opção", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		replaceFetch(stubFetch([
				[/forza-horizon-6-rune\/$/, { body: `<a href="magnet:?xt=urn:btih:HASH123">MAGNET</a>` }],
				[/skidrowreloaded/, { body: SKIDROW_IX_HTML }],
			]),
		);
		try {
			const gw = makeGateway(async () => "ok");
			const list = stubInteraction();
			await gw.onInteraction(list as never);
			const editList = list.editReply as ReturnType<typeof vi.fn>;
			const payload = editList.mock.calls[0]?.[0] as {
				embeds?: { toJSON(): Record<string, unknown> }[];
				components?: unknown[];
			};
			const embed = payload.embeds?.[0]?.toJSON() as Record<string, unknown>;
			const fields = embed["fields"] as { name: string }[];
			expect(fields[0]?.name).toContain("Forza Horizon 6-RUNE");
			expect(payload.components).toHaveLength(1); // botões 1/2
			const btn = stubInteraction({
				commandName: undefined,
				isChatInputCommand: () => false,
				isButton: () => true,
				customId: "skr:0",
				id: "i2",
				user: { id: "u2", username: "be" },
			});
			await gw.onInteraction(btn as never);
			const editBtn = btn.editReply as ReturnType<typeof vi.fn>;
			expect(editBtn).toHaveBeenCalledTimes(1);
			const magnet = String(editBtn.mock.calls[0]?.[0]);
			expect(magnet).toContain("1. Forza Horizon 6-RUNE");
			expect(magnet).toContain("magnet:?xt=urn:btih:HASH123");
		} finally {
			restoreFetch();
			delete process.env["AGENT_ALLOW_PRIVATE"];
		}
	});

	it("botão sem lista no canal recebe efêmero", async () => {
		const gw = makeGateway(async () => "ok");
		const btn = stubInteraction({
			commandName: undefined,
			isChatInputCommand: () => false,
			isButton: () => true,
			customId: "skr:1",
		});
		await gw.onInteraction(btn as never);
		const reply = btn.reply as ReturnType<typeof vi.fn>;
		expect(reply).toHaveBeenCalledTimes(1);
		const arg = reply.mock.calls[0]?.[0] as { ephemeral?: boolean };
		expect(arg.ephemeral).toBe(true);
	});

	it("canal fora da allowlist recebe efêmero", async () => {
		const gw = makeGateway(async () => "ok");
		const ix = stubInteraction({ channelId: "c9" });
		await gw.onInteraction(ix as never);
		const reply = ix.reply as ReturnType<typeof vi.fn>;
		expect(reply).toHaveBeenCalledTimes(1);
		const arg = reply.mock.calls[0]?.[0] as { ephemeral?: boolean };
		expect(arg.ephemeral).toBe(true);
	});

	it("DM recebe efêmero mesmo com guild livre na config", async () => {
		replaceFetch(async () => {
			throw new Error("não deveria buscar");
		});
		try {
			const openGuild = () => ({ ...settings(), discord: { guild_id: "", channel_ids: ["c1"], admin_ids: [] } });
			const gw = makeGateway(async () => "ok", { settings: openGuild });
			const ix = stubInteraction({ guildId: null });
			await gw.onInteraction(ix as never);
			expect(ix.deferReply).not.toHaveBeenCalled();
			const arg = ix.reply.mock.calls[0]?.[0] as { ephemeral?: boolean };
			expect(arg.ephemeral).toBe(true);
		} finally {
			restoreFetch();
		}
	});

	it("ignora outro comando", async () => {
		const gw = makeGateway(async () => "ok");
		const ix = stubInteraction({ commandName: "outro" });
		await gw.onInteraction(ix as never);
		expect(ix.reply as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});
});

function stubIncoming() {
	const events: string[] = [];
	const msg = {
		id: "m1",
		reply: vi.fn(async (c: unknown) => void events.push(`reply ${String(c)}`)),
		react: vi.fn(async (e: string) => void events.push(`react ${e}`)),
		reactions: { cache: new Map([["⏱️", { users: { remove: vi.fn(async () => undefined) } }]]) },
		channel: {
			send: vi.fn(async (c: unknown) => void events.push(`send ${String(c)}`)),
			sendTyping: vi.fn(async () => undefined),
		},
	};
	return { events, msg };
}

describe("discordReplyTarget", () => {
	it("primeiro pedaco vai como reply, o resto no canal, depois drena o outbox", async () => {
		const { events, msg } = stubIncoming();
		const target = discordReplyTarget(msg, "bot", async () => void events.push("outbox"));
		await target.deliver(["a", "b", "c"]);
		expect(events).toEqual(["reply a", "send b", "send c", "outbox"]);
	});

	it("falha drena o outbox e responde a mensagem de erro", async () => {
		const { events, msg } = stubIncoming();
		const target = discordReplyTarget(msg, "bot", async () => void events.push("outbox"));
		await target.fail("falhei aqui: x");
		expect(events).toEqual(["outbox", "reply falhei aqui: x"]);
	});

	it("reply de erro que falha nao propaga", async () => {
		const { msg } = stubIncoming();
		msg.reply = vi.fn(async () => Promise.reject(new Error("sem permissao")));
		await discordReplyTarget(msg, "bot", async () => undefined).fail("x");
	});

	it("whileWorking troca o relogio por check e devolve o resultado", async () => {
		const { events, msg } = stubIncoming();
		const result = await discordReplyTarget(msg, "bot", async () => undefined).whileWorking(async () => 42);
		expect(result).toBe(42);
		expect(events).toEqual(["react ⏱️", "react ✅"]);
	});
});

describe("outbox", () => {
	it("arquivo deixado por tool vai para o canal depois da resposta e e apagado", async () => {
		const base = await mkdtemp(join(tmpdir(), "gw-"));
		await mkdir(join(base, "c1"), { recursive: true });
		await writeFile(join(base, "c1", "v.mp4"), "dados");
		try {
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async () => "baixei", { client: client as never, outboxDir: base });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const events: string[] = [];
			handlers["messageCreate"]?.(
				message({
					id: "m50",
					content: "baixa isso",
					mentions: { users: { size: 1 }, has: () => true },
					attachments: new Map(),
					stickers: new Map(),
					reply: vi.fn(async (c: unknown) => void events.push(`reply ${String(c)}`)),
					react: vi.fn(async () => undefined),
					reactions: { cache: new Map() },
					channel: {
						messages: { cache: new Map() },
						send: vi.fn(async (c: { files?: { attachment: string }[] }) => {
							events.push(`send ${c.files?.[0]?.attachment.endsWith("v.mp4") ? "v.mp4" : "?"}`);
						}),
						sendTyping: vi.fn(async () => undefined),
					},
				}),
			);
			await new Promise((r) => setTimeout(r, 50));
			expect(events).toEqual(["reply baixei", "send v.mp4"]);
			await expect(stat(join(base, "c1", "v.mp4"))).rejects.toThrow();
			await gw.stop();
		} finally {
			await rm(base, { recursive: true, force: true });
		}
	});
});

describe("memoria visual do canal", () => {
	it("foto com mais de 10 min nao entra na resposta", async () => {
		replaceFetch(async () => ({
			ok: true,
			status: 200,
			headers: { get: (h: string) => (h === "content-type" ? "image/png" : null) },
			arrayBuffer: async () => new TextEncoder().encode("IMG").buffer as ArrayBuffer,
		}));
		try {
			const clock = new FakeClock(0);
			const seen: { images?: unknown[] }[] = [];
			const handlers: Record<string, (m: unknown) => void> = {};
			const client = {
				once: () => undefined,
				on: (e: string, h: (m: unknown) => void) => void (handlers[e] = h),
				login: async () => undefined,
				destroy: () => undefined,
			};
			const gw = makeGateway(async (_c, _a, _t, images) => {
					seen.push({ images });
					return "vi";
				}, { client: client as never, clock });
			(gw as unknown as { botUserId: string }).botUserId = "bot";
			await gw.start("tok");
			const base = {
				reply: vi.fn(async () => undefined),
				react: vi.fn(async () => undefined),
				reactions: { cache: new Map() },
				channel: {
					messages: { cache: new Map() },
					send: vi.fn(async () => undefined),
					sendTyping: vi.fn(async () => undefined),
				},
			};
			handlers["messageCreate"]?.(
				message({
					id: "m40",
					content: "",
					attachments: new Map([["a1", { contentType: "image/png", size: 3, url: "https://cdn/velha.png" }]]),
					stickers: new Map(),
					...base,
				}),
			);
			await new Promise((r) => setTimeout(r, 20));
			clock.advance(10 * 60 * 1000 + 1);
			handlers["messageCreate"]?.(
				message({
					id: "m41",
					content: "e essa foto?",
					mentions: { users: { size: 1 }, has: () => true },
					attachments: new Map(),
					stickers: new Map(),
					...base,
				}),
			);
			await new Promise((r) => setTimeout(r, 50));
			expect(seen).toHaveLength(1);
			expect(seen[0]?.images).toEqual([]);
			await gw.stop();
		} finally {
			restoreFetch();
		}
	});
});
