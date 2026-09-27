/** Tool download_media: valida a URL e a plataforma, baixa para o outbox, responde em texto. */

import { parseHttpUrl } from "../domain/http-url.ts";
import { mediaHostAllowed, mediaUnsupportedReason } from "../domain/media-policy.ts";
import type { HostGuard } from "./ports/host-guard.ts";
import type { Logger } from "./ports/logger.ts";
import type { MediaDownloader } from "./ports/media-downloader.ts";

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
		const url = parseHttpUrl(rawUrl);
		if (!url) return "erro: só aceito URL http/https";
		if (!mediaHostAllowed(url.host)) return `erro: ${mediaUnsupportedReason(url.host) || "plataforma sem suporte"}`;
		let result: Awaited<ReturnType<MediaDownloader["download"]>>;
		try {
			await this.guard.assertPublic(url.host);
			result = await this.downloader.download(url.toString(), channelId);
		} catch (err) {
			return `erro: ${err instanceof Error ? err.message : String(err)}`;
		}
		if (result.kind === "failed") {
			this.logger.error(`media_download_failed url=${rawUrl.trim().slice(0, 120)} out=${result.output.slice(0, 500)}`);
			return `erro no download: ${result.output.slice(0, 2000)}`;
		}
		const { files, dropped } = result;
		if (files.length === 0 && dropped.length > 0) {
			return `erro: vídeo grande demais — ${dropped.join(", ")}; o teto de anexo aqui é 20 MB`;
		}
		if (files.length === 0) return "erro: download terminou mas nenhum arquivo novo apareceu";
		const extra = dropped.length > 0 ? `; descartei por tamanho: ${dropped.join(", ")}` : "";
		return `ok: baixado ${files.join(", ")}${extra}. O arquivo será enviado ao canal como anexo.`;
	}
}
