/** Access token do openai-codex a partir do login do pi (~/.pi/agent/auth.json). */

import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";

/** O que usamos do ModelRuntime do pi: ele le o auth.json e renova o OAuth vencido. */
export interface AuthSource {
	getAuth(provider: string): Promise<{ auth: { apiKey?: string } } | undefined>;
}

/** Runtime carregado uma vez; falha nao fica em cache (login feito depois vale). */
export function codexToken(load: () => Promise<AuthSource> = () => ModelRuntime.create()): () => Promise<string> {
	let source: Promise<AuthSource> | undefined;
	return async () => {
		source ??= load().catch((err: unknown) => {
			source = undefined;
			throw err;
		});
		const key = (await (await source).getAuth(PROVIDER))?.auth.apiKey;
		if (!key) throw new Error("sem login do Codex no pi: rode `pi` e faça /login (ChatGPT Plus/Pro)");
		return key;
	};
}
