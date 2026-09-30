import { describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { DownloadMedia } from "../../../application/download-media.ts";
import { GenerateImage } from "../../../application/generate-image.ts";
import type { MediaResult } from "../../../application/ports/media-downloader.ts";
import { Recall } from "../../../application/recall.ts";
import { SearchGames } from "../../../application/search-games.ts";
import { WebResearch } from "../../../application/web-research.ts";
import { FakeClock } from "../../../test-support/fakes/clock.ts";
import { FakeLogger } from "../../../test-support/fakes/logger.ts";
import { FakeMemoryStore } from "../../../test-support/fakes/memory-store.ts";
import { FakeMessageStore } from "../../../test-support/fakes/message-store.ts";
import { FakeOutbox } from "../../../test-support/fakes/outbox.ts";
import { FakePageFetcher } from "../../../test-support/fakes/page-fetcher.ts";
import { botTools } from "./bot-tools.ts";

function setup() {
	const messages = new FakeMessageStore();
	const memories = new FakeMemoryStore();
	const downloads: [string, string][] = [];
	const searches: string[] = [];
	const outbox = new FakeOutbox();
	const prompts: string[] = [];
	const tools = botTools(
		{
			research: new WebResearch(
				{ search: async (q) => `resultado de ${q}` },
				new FakePageFetcher([[/materia/, { body: `<title>T</title><p>${"texto ".repeat(20)}</p>` }]]),
			),
			media: new DownloadMedia(
				{
					download: async (url, channelId): Promise<MediaResult> => {
						downloads.push([url, channelId]);
						return { kind: "done", files: ["v.mp4 (1 bytes)"], dropped: [] };
					},
				},
				{ assertPublic: async () => undefined },
				new FakeLogger(),
			),
			recall: new Recall(messages, memories),
			images: new GenerateImage(
				{
					generate: async (prompt) => {
						prompts.push(prompt);
						return { data: "aW1n", mimeType: "image/png" };
					},
				},
				outbox,
				new FakeClock(7),
				new FakeLogger(),
			),
			games: new SearchGames({
				search: async (name) => {
					searches.push(name);
					return { hits: [{ title: "The Sims 4", url: "https://s/4" }], searchUrl: "https://busca" };
				},
				correctName: async () => null,
				magnet: async (url) => {
					if (url.includes("sem")) throw new Error("magnet não encontrado na página");
					return "magnet:?xt=urn:btih:ABC";
				},
			}),
		},
		"c1",
	);
	const byName = (name: string): ToolDefinition => {
		const tool = tools.find((t) => t.name === name);
		if (!tool) throw new Error(`sem tool ${name}`);
		return tool;
	};
	const run = async (name: string, params: Record<string, unknown>): Promise<string> => {
		const r = await byName(name).execute("t", params as never, undefined as never, undefined as never, {} as never);
		return r.content[0]?.type === "text" ? r.content[0].text : "";
	};
	return { tools, messages, memories, downloads, searches, outbox, prompts, run };
}

describe("botTools", () => {
	it("as 8 tools do bot, nessa ordem", () => {
		expect(setup().tools.map((t) => t.name)).toEqual([
			"web_search",
			"web_fetch",
			"download_media",
			"generate_image",
			"search_history",
			"memory_search",
			"lista",
			"magnet",
		]);
	});

	it("web_search e web_fetch chamam a pesquisa", async () => {
		const { run } = setup();
		expect(await run("web_search", { query: "vasco" })).toBe("resultado de vasco");
		expect(await run("web_search", { query: " " })).toBe("erro: query vazia");
		expect(await run("web_fetch", { url: "https://x/materia" })).toStartWith("Título: T");
		expect(await run("web_fetch", { url: "ftp://x" })).toContain("inválida");
	});

	it("download_media baixa para o canal da conversa", async () => {
		const { run, downloads } = setup();
		expect(await run("download_media", { url: "https://x.com/a" })).toStartWith("ok: baixado v.mp4");
		expect(downloads).toEqual([["https://x.com/a", "c1"]]);
	});

	it("generate_image gera e larga a imagem no outbox do canal da conversa", async () => {
		const { run, outbox, prompts } = setup();
		expect(await run("generate_image", { prompt: "um gato" })).toStartWith("ok:");
		expect(prompts).toEqual(["um gato"]);
		expect(await outbox.pending("c1")).toEqual(["/outbox/c1/imagem-7.png"]);
	});

	it("search_history e memory_search consultam o canal da conversa", async () => {
		const { run, messages, memories } = setup();
		messages.append({ channelId: "c1", authorId: "u1", authorName: "ana", messageId: "m1", body: "Terraria hoje" });
		messages.append({ channelId: "c2", authorId: "u1", authorName: "ana", messageId: "m2", body: "Terraria la" });
		memories.commit("c1", { summary: "", memories: [{ key: "k", kind: "fact", scope: "group", personId: "", content: "ama Terraria" }], forget: [], confirm: [], episodes: [] }, 1);
		expect(await run("search_history", { query: "Terraria", author_id: "u1" })).toContain("Terraria hoje");
		expect(await run("search_history", { query: "Terraria" })).not.toContain("Terraria la");
		expect(await run("memory_search", { query: "Terraria" })).toContain("ama Terraria");
	});

	it("falha no banco vira erro de busca", async () => {
		const { run, messages } = setup();
		messages.search = () => {
			throw new Error("banco travado");
		};
		expect(await run("search_history", { query: "x" })).toBe("erro na busca: banco travado");
	});

	it("lista e magnet: resultado, vazio e erro", async () => {
		const { run, searches } = setup();
		expect(await run("lista", { jogo: "the sims" })).toBe("1. The Sims 4\nhttps://s/4");
		expect(searches).toEqual(["the sims"]);
		expect(await run("lista", { jogo: "  " })).toBe("erro: informe o nome do jogo (ex.: the sims)");
		expect(await run("magnet", { url: "https://s/4" })).toBe("magnet:?xt=urn:btih:ABC");
		expect(await run("magnet", { url: " " })).toBe("erro: informe a URL da postagem (uma das 3 listadas)");
		expect(await run("magnet", { url: "https://s/sem" })).toBe("erro: magnet não encontrado na página");
	});
});
