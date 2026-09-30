/** Tool generate_image: gera a imagem do prompt e larga no outbox do canal; responde em texto. */

import type { Clock } from "./ports/clock.ts";
import type { ImageGenerator } from "./ports/image-generator.ts";
import type { Logger } from "./ports/logger.ts";
import type { Outbox } from "./ports/outbox.ts";

const MAX_PROMPT = 4000;

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export class GenerateImage {
	private readonly generator: ImageGenerator;
	private readonly outbox: Outbox;
	private readonly clock: Clock;
	private readonly logger: Logger;

	constructor(generator: ImageGenerator, outbox: Outbox, clock: Clock, logger: Logger) {
		this.generator = generator;
		this.outbox = outbox;
		this.clock = clock;
		this.logger = logger;
	}

	async run(rawPrompt: string, channelId: string): Promise<string> {
		const prompt = rawPrompt.trim().slice(0, MAX_PROMPT);
		if (!prompt) return "erro: descreva a imagem";
		try {
			const image = await this.generator.generate(prompt);
			const ext = EXTENSIONS[image.mimeType] ?? "png";
			await this.outbox.save(channelId, `imagem-${this.clock.now()}.${ext}`, image.data);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error(`image_generation_failed canal=${channelId} erro=${message.slice(0, 500)}`);
			return `erro ao gerar imagem: ${message}`;
		}
		return "ok: imagem gerada. Ela será enviada ao canal como anexo junto com a sua resposta.";
	}
}
