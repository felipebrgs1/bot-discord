import { describe, expect, it } from "bun:test";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { DownloadMedia } from "./download-media.ts";
import type { MediaDownloader, MediaResult } from "./ports/media-downloader.ts";

const openGuard = { assertPublic: async () => undefined };

function downloader(result: MediaResult) {
	const calls: [string, string][] = [];
	const fake: MediaDownloader = {
		download: async (url, channelId) => {
			calls.push([url, channelId]);
			return result;
		},
	};
	return { calls, fake };
}

const done = (files: string[], dropped: string[] = []): MediaResult => ({ kind: "done", files, dropped });

describe("DownloadMedia", () => {
	it("baixa de plataforma suportada e avisa que vai como anexo", async () => {
		const { calls, fake } = downloader(done(["1.mp4 (10 bytes)"]));
		const text = await new DownloadMedia(fake, openGuard, new FakeLogger()).run(" https://x.com/u/status/1 ", "c1");
		expect(text).toBe("ok: baixado 1.mp4 (10 bytes). O arquivo será enviado ao canal como anexo.");
		expect(calls).toEqual([["https://x.com/u/status/1", "c1"]]);
	});

	it("recusa URL invalida e plataforma sem suporte sem baixar", async () => {
		const { calls, fake } = downloader(done([]));
		const media = new DownloadMedia(fake, openGuard, new FakeLogger());
		expect(await media.run("não-url", "c1")).toBe("erro: só aceito URL http/https");
		expect(await media.run("https://www.youtube.com/watch?v=abc", "c1")).toContain("X/Twitter, TikTok");
		expect(await media.run("https://exemplo.com/v", "c1")).toBe("erro: plataforma sem suporte");
		expect(calls).toEqual([]);
	});

	it("destino interno bloqueado vira erro", async () => {
		const guard = {
			assertPublic: async () => {
				throw new Error("destino interno bloqueado");
			},
		};
		const { fake } = downloader(done([]));
		expect(await new DownloadMedia(fake, guard, new FakeLogger()).run("https://x.com/a", "c1")).toBe(
			"erro: destino interno bloqueado",
		);
	});

	it("falha do downloader vira erro honesto e log", async () => {
		const logger = new FakeLogger();
		const { fake } = downloader({ kind: "failed", output: "ERROR: private video" });
		expect(await new DownloadMedia(fake, openGuard, logger).run("https://x.com/a", "c1")).toBe(
			"erro no download: ERROR: private video",
		);
		expect(logger.lines[0]).toStartWith("error media_download_failed");
	});

	it("so grande demais, nada novo, e parcial", async () => {
		const run = (r: MediaResult) => new DownloadMedia(downloader(r).fake, openGuard, new FakeLogger()).run("https://x.com/a", "c1");
		expect(await run(done([], ["v.mp4 (30.0 MB, não coube: x)"]))).toBe(
			"erro: vídeo grande demais — v.mp4 (30.0 MB, não coube: x); o teto de anexo aqui é 20 MB",
		);
		expect(await run(done([]))).toBe("erro: download terminou mas nenhum arquivo novo apareceu");
		expect(await run(done(["a.mp4 (1 bytes)"], ["b.mp4 (grande)"]))).toBe(
			"ok: baixado a.mp4 (1 bytes); descartei por tamanho: b.mp4 (grande). O arquivo será enviado ao canal como anexo.",
		);
	});
});
