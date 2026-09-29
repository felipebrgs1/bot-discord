/**
 * Comandos de texto no chat: !lista/lista (qualquer um) e !soul/!souls (so
 * admin). Devolve a resposta, ou null quando o texto nao e comando.
 */

import { roleOf } from "../domain/roles.ts";
import type { ChatSessions } from "./ports/chat-agent.ts";
import type { SoulStore } from "./ports/soul-store.ts";
import type { SearchGames } from "./search-games.ts";

export interface TextCommandDeps {
	games: SearchGames;
	souls: SoulStore;
	sessions: ChatSessions;
	adminIds: () => readonly string[];
}

export interface CommandInput {
	channelId: string;
	authorId: string;
	text: string;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class TextCommands {
	private readonly deps: TextCommandDeps;

	constructor(deps: TextCommandDeps) {
		this.deps = deps;
	}

	async handle(input: CommandInput): Promise<string | null> {
		const raw = input.text.trim();
		const [cmd = "", arg = ""] = raw.split(/\s+/);
		if (cmd === "!lista" || cmd === "/lista") return this.lista(raw.slice(cmd.length).trim());
		if (cmd !== "!soul" && cmd !== "!souls") return null;
		const { souls, sessions, adminIds } = this.deps;
		if (roleOf(input.authorId, adminIds()) !== "admin") return "só o dono troca a mente do bot.";
		if (cmd === "!souls" || !arg) {
			const names = souls.list().map((s) => s.name).join(", ") || "(nenhuma)";
			return `souls: ${names} | aqui: ${souls.channelSoul(input.channelId)}`;
		}
		try {
			souls.setChannel(input.channelId, arg);
		} catch (err) {
			return `não rolou: ${errorText(err)}`;
		}
		sessions.forget(input.channelId);
		return `mente trocada: agora sou **${arg}** neste canal.`;
	}

	private async lista(jogo: string): Promise<string> {
		if (!jogo) return "uso: /lista nome do jogo (ex.: /lista the sims)";
		try {
			return (await this.deps.games.search(jogo)).text;
		} catch (err) {
			return `não rolou: ${errorText(err)}`;
		}
	}
}
