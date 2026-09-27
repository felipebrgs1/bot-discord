import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { replaceFetch, restoreFetch } from "../test-support/stub-fetch.ts";
import { migrate } from "../db.ts";
import { discard, outboxDirFor, pendingAttachments } from "../outbox.ts";
import { LogBuffer } from "../weblog.ts";
import { searchHistoryTool } from "./history.ts";
import { type ToolCtx, toolsFor } from "./index.ts";
import { downloadMediaTool } from "./media.ts";
import { guardSSRF, htmlToText } from "./net.ts";
import {
	buildSkidrowLink,
	colorForGame,
	correctGameName,
	fetchMagnet,
	formatSkidrowTop,
	listaEmbed,
	listaJogo,
	listaTool,
	parseMagnet,
	parseSkidrowTop,
} from "./skidrow.ts";
import { webFetchTool, webSearchTool } from "./web.ts";

const RSS = `<?xml version="1.0"?>
<rss><channel>
<item><title><![CDATA[Vasco vence - ge.globo]]></title><link>https://exemplo/noticia</link><pubDate>Tue, 08 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Outro jogo - uol</title><link>https://exemplo/outra</link><pubDate>bad-date</pubDate></item>
</channel></rss>`;

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

afterEach(() => {
	restoreFetch();
	delete process.env["AGENT_ALLOW_PRIVATE"];
	delete process.env["YTDLP_BIN"];
});

function memDb(): DatabaseSync {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	return db;
}

function ctx(channelId: string, db: DatabaseSync, outboxDir: string): ToolCtx {
	return { channelId, db, log: new LogBuffer(), outboxDir };
}

describe("web_search", () => {
	it("formata RSS com fonte e data", async () => {
		replaceFetch(stubFetch([[/news\.google/, { body: RSS }]]));
		const tool = webSearchTool();
		const r = await tool.execute(
			"t",
			{ query: "vasco" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("Notícias recentes:");
		expect(text).toContain("Vasco vence");
		expect(text).toContain("ge.globo");
		expect(text).toContain("08/09/2026");
		expect(text).toContain("https://exemplo/noticia");
	});

	it("recusa query vazia sem rede", async () => {
		const fetch = vi.fn(async () => {
			throw new Error("não deveria chamar rede");
		});
		replaceFetch(fetch);
		const tool = webSearchTool();
		const r = await tool.execute("t", { query: "  " } as never, undefined as never, undefined as never, {} as never);
		expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("vazia");
		expect(fetch).not.toHaveBeenCalled();
	});

	it("cai para wiki+instant quando o RSS vem vazio", async () => {
		replaceFetch(stubFetch([
				[/news\.google/, { body: "<rss><channel></channel></rss>" }],
				[/wikipedia.*list=search/, { body: JSON.stringify({ query: { search: [{ title: "Vasco" }] } }) }],
				[
					/rest_v1\/page\/summary/,
					{
						body: JSON.stringify({
							title: "Vasco",
							extract: "Clube brasileiro",
							content_urls: { desktop: { page: "https://pt.wikipedia.org/wiki/Vasco" } },
						}),
					},
				],
				[
					/duckduckgo/,
					{ body: JSON.stringify({ AbstractText: "resumo ddg", AbstractURL: "https://ddg", Answer: "42" }) },
				],
			]),
		);
		const tool = webSearchTool();
		const r = await tool.execute(
			"t",
			{ query: "vasco" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("Wikipedia — Vasco");
		expect(text).toContain("resumo ddg");
		expect(text).toContain("Resposta direta: 42");
	});
});

describe("web_fetch", () => {
	it("extrai título e texto, descarta script e linha curta", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1"; // pula DNS/SSRF (host fictício)
		replaceFetch(stubFetch([
				[
					/exemplo/,
					{
						body: "<html><head><title>Matéria Boa</title><script>var x=1;</script></head><body><p>Primeiro parágrafo com conteúdo suficiente para passar do corte mínimo de caracteres aqui.</p><p>oi</p></body></html>",
					},
				],
			]),
		);
		const tool = webFetchTool();
		const r = await tool.execute(
			"t",
			{ url: "https://exemplo/materia" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("Título: Matéria Boa");
		expect(text).toContain("Primeiro parágrafo");
		expect(text).not.toContain("var x=1");
	});

	it("barra URL não-http sem rede", async () => {
		const tool = webFetchTool();
		const r = await tool.execute(
			"t",
			{ url: "ftp://x/y" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("inválida");
	});
});

describe("guardSSRF", () => {
	it("bloqueia localhost e metadata sem DNS", async () => {
		await expect(guardSSRF("localhost")).rejects.toThrow("bloqueado");
		await expect(guardSSRF("metadata.google.internal")).rejects.toThrow("bloqueado");
		await expect(guardSSRF("x.internal")).rejects.toThrow("bloqueado");
	});

	it("AGENT_ALLOW_PRIVATE libera", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		await expect(guardSSRF("localhost")).resolves.toBeUndefined();
	});
});

describe("htmlToText", () => {
	it("remove script/style e filtra linha curta", () => {
		const { title, text } = htmlToText(
			"<html><head><title>T</title><style>.a{}</style></head><body>\n<p>linha longa o bastante para sobreviver ao filtro mínimo aplicado aqui</p>\n<p>curta</p>\n<script>var x=1;</script></body></html>",
		);
		expect(title).toBe("T");
		expect(text).toContain("linha longa");
		expect(text).not.toContain("var x=1");
		expect(text).not.toContain(".a{}");
		const lines = text.split("\n");
		expect(lines.every((l) => l.length > 40)).toBe(true);
	});
});

describe("download_media", () => {
	it("barra plataforma sem suporte sem baixar", async () => {
		const db = memDb();
		const tool = downloadMediaTool(ctx("c1", db, "/tmp/outbox-inexistente"));
		const r = await tool.execute(
			"t",
			{ url: "https://www.youtube.com/watch?v=abc" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("X/Twitter, TikTok");
		db.close();
	});

	it("barra URL inválida", async () => {
		const db = memDb();
		const tool = downloadMediaTool(ctx("c1", db, "/tmp/outbox-inexistente"));
		const r = await tool.execute(
			"t",
			{ url: "não-url" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("http/https");
		db.close();
	});

	it("falha honesta quando o yt-dlp quebra", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1"; // pula DNS/SSRF
		process.env["YTDLP_BIN"] = "/bin/false"; // falha imediata, sem rede
		const dir = await mkdtemp(join(tmpdir(), "outbox-"));
		const db = memDb();
		try {
			const tool = downloadMediaTool(ctx("c1", db, dir));
			const r = await tool.execute(
				"t",
				{ url: "https://x.com/u/status/1" } as never,
				undefined as never,
				undefined as never,
				{} as never,
			);
			expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("erro no download");
		} finally {
			db.close();
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("search_history", () => {
	function seed(): DatabaseSync {
		const db = memDb();
		const ins = db.prepare(
			"INSERT INTO messages (channel_id, author_id, author_name, message_id, body, created_at) VALUES (?,?,?,?,?,?);",
		);
		ins.run("c1", "u1", "ana", "m1", "meu jogo favorito é Terraria", "2026-09-20T10:00:00.000Z");
		ins.run("c1", "u2", "bob", "m2", "Terraria é ótimo mesmo, joguei ontem", "2026-09-20T10:05:00.000Z");
		ins.run("c1", "u1", "ana", "m3", "alguém viu meu gato?", "2026-09-21T10:00:00.000Z");
		ins.run("c2", "u1", "ana", "m4", "Terraria no outro canal não conta", "2026-09-20T10:00:00.000Z");
		return db;
	}

	it("acha por FTS com autor, data e contexto", async () => {
		const db = seed();
		const tool = searchHistoryTool(ctx("c1", db, "/tmp/x"));
		const r = await tool.execute(
			"t",
			{ query: "Terraria" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("ana");
		expect(text).toContain("meu jogo favorito é Terraria");
		expect(text).toContain("bob");
		expect(text).not.toContain("outro canal");
		db.close();
	});

	it("filtra por autor e respeita limite", async () => {
		const db = seed();
		const tool = searchHistoryTool(ctx("c1", db, "/tmp/x"));
		const r = await tool.execute(
			"t",
			{ query: "Terraria", author_id: "u2", limit: 1 } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("• bob");
		expect(text).not.toContain("• ana"); // contexto (│) pode citar a ana
		db.close();
	});

	it("sem query lista recentes; sem nada avisa", async () => {
		const db = seed();
		const tool = searchHistoryTool(ctx("c1", db, "/tmp/x"));
		const recent = await tool.execute("t", {} as never, undefined as never, undefined as never, {} as never);
		expect(recent.content[0]?.type === "text" ? recent.content[0].text : "").toContain("gato");
		const empty = await tool.execute(
			"t",
			{ query: "zzz-nunca" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		expect(empty.content[0]?.type === "text" ? empty.content[0].text : "").toContain("nada encontrado");
		db.close();
	});
});

const SKIDROW_HTML = `<html><body>
<h2>3 search results for "the sims"</h2>
<img decoding="async" class="aligncenter" src="https://www.skidrowreloaded.com/wp-content/uploads/sims4.jpg" alt="The Sims 4 v1.2.3" />
<h2><a href="https://www.skidrowreloaded.com/the-sims-4-v1-2-3/">The Sims 4 v1.2.3</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-3-v4-5-6/">The Sims 3 v4.5.6</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-2-v7-8-9/">The Sims 2 v7.8.9</a></h2>
<h2><a href="https://www.skidrowreloaded.com/the-sims-1-v0-1/">The Sims 1 v0.1</a></h2>
</body></html>`;

describe("lista", () => {
	it("monta link com + no lugar do espaço", () => {
		expect(buildSkidrowLink("the sims")).toBe("https://www.skidrowreloaded.com/?s=the+sims&x=15&y=25");
		expect(buildSkidrowLink("  elden   ring  ")).toBe("https://www.skidrowreloaded.com/?s=elden+ring&x=15&y=25");
		expect(() => buildSkidrowLink("   ")).toThrow();
	});

	it("parse pega só h2 com link, top 3, capa pelo alt", () => {
		const hits = parseSkidrowTop(SKIDROW_HTML);
		expect(hits).toHaveLength(3);
		expect(hits[0]).toEqual({
			title: "The Sims 4 v1.2.3",
			url: "https://www.skidrowreloaded.com/the-sims-4-v1-2-3/",
			cover: "https://www.skidrowreloaded.com/wp-content/uploads/sims4.jpg",
		});
		expect(hits[2]?.title).toBe("The Sims 2 v7.8.9");
		expect(hits[1]?.cover).toBeUndefined();
		expect(parseSkidrowTop("<html><body><h2>0 search results</h2></body></html>")).toEqual([]);
	});

	it("embed: título curto com emoji, capa grande, 3 fields, footer+timestamp", () => {
		const embed = listaEmbed("The Sims 4", parseSkidrowTop(SKIDROW_HTML)).toJSON();
		expect(embed.title).toBe("🎮 The Sims 4");
		expect(embed.image?.url).toBe("https://www.skidrowreloaded.com/wp-content/uploads/sims4.jpg");
		expect(embed.thumbnail).toBeUndefined();
		expect(embed.description).toBeUndefined();
		expect(embed.fields).toHaveLength(3);
		expect(embed.fields?.[0]).toMatchObject({
			name: "1. The Sims 4 v1.2.3",
			value: "[🔗 Ver página](https://www.skidrowreloaded.com/the-sims-4-v1-2-3/)",
		});
		expect(embed.footer?.text).toContain("Top 3");
		expect(embed.timestamp).toBeTruthy();
		const fixed = listaEmbed("The Sims 4", parseSkidrowTop(SKIDROW_HTML), "thesims").toJSON();
		expect(fixed.footer?.text).toContain("thesims → The Sims 4");
	});

	it("cor lateral varia por jogo e nunca é o cinza padrão", () => {
		const a = colorForGame("The Sims 4");
		const b = colorForGame("Forza Horizon 6");
		expect(a).not.toBe(0x2b2d31);
		expect(colorForGame("The Sims 4")).toBe(a); // determinística
		expect(a).not.toBe(b);
	});

	it("formata numerado; sem hit devolve link da busca", () => {
		const text = formatSkidrowTop("the sims", parseSkidrowTop(SKIDROW_HTML));
		expect(text).toContain("1. The Sims 4 v1.2.3\nhttps://www.skidrowreloaded.com/the-sims-4-v1-2-3/");
		expect(text).toContain("3. The Sims 2");
		expect(text).not.toContain("The Sims 1");
		expect(formatSkidrowTop("zzz", [])).toContain("https://www.skidrowreloaded.com/?s=zzz&x=15&y=25");
	});

	it("corrige nome grudado via Steam quando Skidrow volta vazio", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		const fetch = stubFetch([
			[/\?s=thesims/, { body: "<html><body><h2>0 search results</h2></body></html>" }],
			[/storesearch/, { body: JSON.stringify({ items: [{ name: "The Sims™ 4" }] }) }],
			[/skidrowreloaded/, { body: SKIDROW_HTML }],
		]);
		replaceFetch(fetch);
		expect(await correctGameName("thesims")).toBe("The Sims 4");
		const text = await listaJogo("thesims");
		expect(text).toContain("Nome corrigido: thesims → The Sims 4");
		expect(text).toContain("1. The Sims 4");
	});

	it("busca direta com acerto não chama o Steam", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		const fetch = stubFetch([[/skidrowreloaded/, { body: SKIDROW_HTML }]]);
		replaceFetch(fetch);
		const text = await listaJogo("the sims");
		expect(text).toContain("1. The Sims 4");
		expect(text).not.toContain("corrigido");
		expect(fetch.mock.calls.map((c) => String(c[0])).some((u) => u.includes("storesearch"))).toBe(false);
	});

	it("parseMagnet pega o primeiro e decodifica &#038;", () => {
		const html = `<a href="magnet:?xt=urn:btih:ABC&#038;dn=Jogo&#038;tr=udp%3A//t/announce">MAGNET</a>`;
		expect(parseMagnet(html)).toBe("magnet:?xt=urn:btih:ABC&dn=Jogo&tr=udp%3A//t/announce");
		expect(parseMagnet("<html><body>sem magnet</body></html>")).toBeNull();
	});

	it("fetchMagnet baixa post e devolve magnet; sem magnet erra", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1";
		replaceFetch(stubFetch([
				[/com-magnet/, { body: `<a href="magnet:?xt=urn:btih:ABC">M</a>` }],
				[/sem-magnet/, { body: "<html>nada</html>" }],
			]),
		);
		expect(await fetchMagnet("https://skidrow.exemplo/com-magnet/")).toBe("magnet:?xt=urn:btih:ABC");
		await expect(fetchMagnet("https://skidrow.exemplo/sem-magnet/")).rejects.toThrow("magnet não encontrado");
		await expect(fetchMagnet("ftp://x/y")).rejects.toThrow("inválida");
	});

	it("tool lista top 3 com rede mockada", async () => {
		process.env["AGENT_ALLOW_PRIVATE"] = "1"; // pula DNS/SSRF (host fictício)
		replaceFetch(stubFetch([[/skidrowreloaded/, { body: SKIDROW_HTML }]]));
		const tool = listaTool();
		expect(tool.name).toBe("lista");
		const r = await tool.execute(
			"t",
			{ jogo: "the sims" } as never,
			undefined as never,
			undefined as never,
			{} as never,
		);
		const text = r.content[0]?.type === "text" ? r.content[0].text : "";
		expect(text).toContain("1. The Sims 4");
		expect(text).toContain("https://www.skidrowreloaded.com/the-sims-4-v1-2-3/");
	});

	it("normaliza espaços extras e recusa vazio sem rede", async () => {
		expect(buildSkidrowLink("  elden   ring  ")).toBe("https://www.skidrowreloaded.com/?s=elden+ring&x=15&y=25");
		const tool = listaTool();
		const r = await tool.execute("t", { jogo: "   " } as never, undefined as never, undefined as never, {} as never);
		expect(r.content[0]?.type === "text" ? r.content[0].text : "").toContain("informe o nome");
	});
});

describe("toolsFor", () => {
	it("user e admin recebem as 7 tools do bot", () => {
		const db = memDb();
		for (const role of ["user", "admin"] as const) {
			const names = toolsFor(role, ctx("c1", db, "/tmp/x")).map((t) => t.name);
			expect(names).toEqual([
				"web_search",
				"web_fetch",
				"download_media",
				"search_history",
				"memory_search",
				"lista",
				"magnet",
			]);
		}
		db.close();
	});
});

describe("outbox", () => {
	it("lista, ignora dotfile e descarta", async () => {
		const base = await mkdtemp(join(tmpdir(), "ob-"));
		const dir = outboxDirFor(base, "canal-1");
		const { mkdir, writeFile: wf } = await import("node:fs/promises");
		await mkdir(dir, { recursive: true });
		await wf(join(dir, "a.mp4"), "x");
		await wf(join(dir, ".tmp"), "x");
		expect(await pendingAttachments(base, "canal-1")).toEqual([join(dir, "a.mp4")]);
		await discard(join(dir, "a.mp4"));
		expect(await pendingAttachments(base, "canal-1")).toEqual([]);
		await rm(base, { recursive: true, force: true });
	});

	it("dir inexistente vira lista vazia", async () => {
		expect(await pendingAttachments("/tmp/nao-existe-xyz", "c")).toEqual([]);
	});

	it("sanitiza channel id no path", () => {
		expect(outboxDirFor("/b", "../../etc")).not.toContain("..");
	});
});
