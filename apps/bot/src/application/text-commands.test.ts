import { describe, expect, it } from "bun:test";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import type { ChatSessions } from "./ports/chat-agent.ts";
import { SearchGames } from "./search-games.ts";
import { TextCommands } from "./text-commands.ts";

function setup() {
	const souls = new FakeSoulStore();
	souls.ensureSeed("padrão");
	souls.save("serio", "sério");
	const forgotten: string[] = [];
	const sessions: ChatSessions = { conversations: () => [], forget: (c) => void forgotten.push(c) };
	const commands = new TextCommands({
		games: new SearchGames({
			search: async (name) => {
				if (name === "boom") throw new Error("rede caiu");
				return { hits: [{ title: "The Sims 4", url: "https://s/4" }], searchUrl: "https://busca" };
			},
			correctName: async () => null,
			magnet: async () => "",
		}),
		souls,
		sessions,
		adminIds: () => ["dono"],
	});
	const run = (text: string, authorId = "dono") => commands.handle({ channelId: "c1", authorId, text });
	return { souls, forgotten, run };
}

describe("TextCommands", () => {
	it("texto comum nao e comando", async () => {
		expect(await setup().run("oi bot")).toBeNull();
		expect(await setup().run("!outro")).toBeNull();
	});

	it("!lista e /lista pesquisam o jogo (qualquer pessoa)", async () => {
		const { run } = setup();
		expect(await run("!lista the sims", "u1")).toBe("1. The Sims 4\nhttps://s/4");
		expect(await run("/lista  the sims ", "u1")).toBe("1. The Sims 4\nhttps://s/4");
	});

	it("!lista sem jogo ensina o uso; falha vira mensagem", async () => {
		const { run } = setup();
		expect(await run("!lista")).toBe("uso: /lista nome do jogo (ex.: /lista the sims)");
		expect(await run("!lista boom")).toBe("não rolou: rede caiu");
	});

	it("!souls lista as souls e a do canal (so admin)", async () => {
		const { run } = setup();
		expect(await run("!souls")).toBe("souls: elmatadore, serio | aqui: elmatadore");
		expect(await run("!soul")).toBe("souls: elmatadore, serio | aqui: elmatadore");
		expect(await run("!souls", "u1")).toBe("só o dono troca a mente do bot.");
	});

	it("!soul <nome> troca a mente do canal e derruba a sessao", async () => {
		const { run, souls, forgotten } = setup();
		expect(await run("!soul serio")).toBe("mente trocada: agora sou **serio** neste canal.");
		expect(souls.channelSoul("c1")).toBe("serio");
		expect(forgotten).toEqual(["c1"]);
	});

	it("!soul desconhecida nao troca nada", async () => {
		const { run, forgotten } = setup();
		expect(await run("!soul fantasma")).toBe("não rolou: soul desconhecida: fantasma");
		expect(forgotten).toEqual([]);
	});
});
