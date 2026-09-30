/** Tool download_media e /baixar: valida a URL e a plataforma, baixa para o outbox, responde em texto. */

import { parseHttpUrl } from "../domain/http-url.ts";
import { mediaHostAllowed, mediaUnsupportedReason } from "../domain/media-policy.ts";
import type { HostGuard } from "./ports/host-guard.ts";
import type { Logger } from "./ports/logger.ts";
import type { MediaDownloader } from "./ports/media-downloader.ts";

/** ok: ha arquivo novo no outbox do canal. */
export interface MediaOutcome {
	ok: boolean;
	text: string;
}

const fail = (text: string): MediaOutcome => ({ ok: false, text });

export class DownloadMedia {
	private readonly downloader: MediaDownloader;
	private readonly guard: HostGuard;
	private readonly logger: Logger;

	constructor(downloader: MediaDownloader, guard: HostGuard, logger: Logger) {
		this.downloader = downloader;
		this.guard = guard;
		this.logger = logger;
	}

	async run(rawUrl: string, channelId: string): Promise<string> {
		return (await this.fetch(rawUrl, channelId)).text;
	}

	async fetch(rawUrl: string, channelId: string): Promise<MediaOutcome> {
		const url = parseHttpUrl(rawUrl);
		if (!url) return fail("erro: só aceito URL http/https");
		if (!mediaHostAllowed(url.host)) return fail(`erro: ${mediaUnsupportedReason(url.host) || "plataforma sem suporte"}`);
		let result: Awaited<ReturnType<MediaDownloader["download"]>>;
		try {
			await this.guard.assertPublic(url.host);
			result = await this.downloader.download(url.toString(), channelId);
		} catch (err) {
			return fail(`erro: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (result.kind === "failed") {
			this.logger.error(`media_download_failed url=${rawUrl.trim().slice(0, 120)} out=${result.output.slice(0, 500)}`);
			return fail(`erro no download: ${result.output.slice(0, 2000)}`);
		}
		const { files, dropped } = result;
		if (files.length === 0 && dropped.length > 0) {
			return fail(`erro: vídeo grande demais — ${dropped.join(", ")}; o teto de anexo aqui é 20 MB`);
		}
		if (files.length === 0) return fail("erro: download terminou mas nenhum arquivo novo apareceu");
		const extra = dropped.length > 0 ? `; descartei por tamanho: ${dropped.join(", ")}` : "";
		return { ok: true, text: `ok: baixado ${files.join(", ")}${extra}. O arquivo será enviado ao canal como anexo.` };
	}
}
