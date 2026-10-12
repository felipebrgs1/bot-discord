/** Anexos de texto do chat viram texto do turno. Falha isolada so descarta aquele arquivo. */

import { filesText, MAX_TEXT_FILE_BYTES, MAX_TEXT_FILES } from "@/domain/text-file.ts";
import type { PageFetcher } from "./ports/page-fetcher.ts";

export interface TextFileRef {
	name: string;
	url: string;
}

export class ReadTextFiles {
	private readonly fetcher: PageFetcher;

	constructor(fetcher: PageFetcher) {
		this.fetcher = fetcher;
	}

	/** Texto dos arquivos com o nome de cada um; '' quando nenhum deu certo. */
	async run(files: readonly TextFileRef[]): Promise<string> {
		const got = await Promise.all(files.slice(0, MAX_TEXT_FILES).map((f) => this.one(f)));
		return filesText(got.filter((g): g is { name: string; text: string } => g !== null));
	}

	private async one(file: TextFileRef): Promise<{ name: string; text: string } | null> {
		try {
			const { status, text } = await this.fetcher.text(file.url, MAX_TEXT_FILE_BYTES);
			if (status < 200 || status >= 300 || !text.trim()) return null;
			return { name: file.name, text };
		} catch {
			return null;
		}
	}
}
