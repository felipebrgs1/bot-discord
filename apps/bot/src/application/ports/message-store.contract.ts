import { expect, it } from "bun:test";
import type { NewMessage } from "../../domain/message.ts";
import type { HistorySearch } from "./history-search.ts";
import type { MessageStore } from "./message-store.ts";

const msg = (over: Partial<NewMessage> & { messageId: string }): NewMessage => ({
	channelId: "c1",
	authorId: "u1",
	authorName: "ana",
	body: "oi",
	...over,
});

export function messageStoreContract(make: () => MessageStore): void {
	it("append devolve a mensagem com seq crescente e createdAt", () => {
		const store = make();
		const a = store.append(msg({ messageId: "m1", createdAt: "2026-09-20T10:00:00.000Z" }));
		const b = store.append(msg({ messageId: "m2", replyTo: "m1" }));
		expect(a?.createdAt).toBe("2026-09-20T10:00:00.000Z");
		expect(b?.replyTo).toBe("m1");
		expect(a?.replyTo).toBeNull();
		expect((b?.seq ?? 0) > (a?.seq ?? 0)).toBe(true);
		expect(b?.createdAt).not.toBe("");
	});

	it("guarda se a mensagem veio de bot (padrao: nao)", () => {
		const store = make();
		store.append(msg({ messageId: "m1" }));
		store.append(msg({ messageId: "m2", authorId: "bot", fromBot: true }));
		expect(store.listChannel("c1", 10).map((m) => m.fromBot)).toEqual([false, true]);
	});

	it("messageId repetido e ignorado", () => {
		const store = make();
		store.append(msg({ messageId: "m1", body: "primeira" }));
		expect(store.append(msg({ messageId: "m1", body: "de novo" }))).toBeUndefined();
		expect(store.listChannel("c1", 10).map((m) => m.body)).toEqual(["primeira"]);
	});

	it("listChannel e so do canal, antigas primeiro, com limite", () => {
		const store = make();
		store.append(msg({ messageId: "m1", body: "a" }));
		store.append(msg({ messageId: "m2", body: "b", channelId: "c2" }));
		store.append(msg({ messageId: "m3", body: "c" }));
		expect(store.listChannel("c1", 10).map((m) => m.body)).toEqual(["a", "c"]);
		expect(store.listChannel("c1", 1).map((m) => m.body)).toEqual(["a"]);
	});

	it("deleteChannel apaga so aquele canal", () => {
		const store = make();
		store.append(msg({ messageId: "m1" }));
		store.append(msg({ messageId: "m2", channelId: "c2" }));
		store.deleteChannel("c1");
		expect(store.listChannel("c1", 10)).toEqual([]);
		expect(store.listChannel("c2", 10)).toHaveLength(1);
	});

	it("after devolve o que veio depois do seq, com limite", () => {
		const store = make();
		const first = store.append(msg({ messageId: "m1", body: "a" }));
		store.append(msg({ messageId: "m2", body: "b" }));
		store.append(msg({ messageId: "m3", body: "c" }));
		expect(store.after("c1", first?.seq ?? 0, 10).map((m) => m.body)).toEqual(["b", "c"]);
		expect(store.after("c1", 0, 2).map((m) => m.body)).toEqual(["a", "b"]);
	});

	it("sinceLastBotMessage traz o que veio depois da ultima fala de bot no canal", () => {
		const store = make();
		store.append(msg({ messageId: "m1", body: "antes" }));
		store.append(msg({ messageId: "m2", authorId: "bot", body: "resposta", fromBot: true }));
		store.append(msg({ messageId: "m3", body: "depois 1" }));
		store.append(msg({ messageId: "m4", body: "outro canal", channelId: "c2" }));
		store.append(msg({ messageId: "m5", body: "depois 2" }));
		expect(store.sinceLastBotMessage("c1", 10).map((m) => m.body)).toEqual(["depois 1", "depois 2"]);
	});

	it("sinceLastBotMessage sem fala de bot traz as mais novas ate o limite", () => {
		const store = make();
		for (const i of [1, 2, 3]) store.append(msg({ messageId: `m${i}`, body: `m${i}` }));
		expect(store.sinceLastBotMessage("c1", 2).map((m) => m.body)).toEqual(["m2", "m3"]);
	});
}

export function historySearchContract(make: () => MessageStore & HistorySearch): void {
	function seeded() {
		const store = make();
		store.append(msg({ messageId: "m1", body: "meu jogo favorito é Terraria", createdAt: "2026-09-20T10:00:00.000Z" }));
		store.append(
			msg({
				messageId: "m2",
				authorId: "u2",
				authorName: "bob",
				body: "Terraria é ótimo mesmo, joguei ontem",
				createdAt: "2026-09-20T10:05:00.000Z",
			}),
		);
		store.append(msg({ messageId: "m3", body: "alguém viu meu gato?", createdAt: "2026-09-21T10:00:00.000Z" }));
		store.append(msg({ messageId: "m4", channelId: "c2", body: "Terraria no outro canal não conta" }));
		return store;
	}

	it("acha por palavra so no canal, com contexto vizinho", () => {
		const hits = seeded().search({ channelId: "c1", text: "Terraria", limit: 5 });
		expect(hits.map((h) => h.body).sort()).toEqual(["Terraria é ótimo mesmo, joguei ontem", "meu jogo favorito é Terraria"]);
		const ana = hits.find((h) => h.authorName === "ana");
		expect(ana?.createdAt).toBe("2026-09-20T10:00:00.000Z");
		expect(ana?.context.map((c) => c.authorName)).toEqual(["bob", "ana"]);
	});

	it("filtra por autor e respeita limite", () => {
		const hits = seeded().search({ channelId: "c1", text: "Terraria", authorId: "u2", limit: 1 });
		expect(hits.map((h) => h.authorName)).toEqual(["bob"]);
	});

	it("sem texto devolve as mais recentes, antigas primeiro", () => {
		const hits = seeded().search({ channelId: "c1", limit: 2 });
		expect(hits.map((h) => h.body)).toEqual(["Terraria é ótimo mesmo, joguei ontem", "alguém viu meu gato?"]);
	});

	it("aspas e simbolos na busca nao quebram", () => {
		expect(() => seeded().search({ channelId: "c1", text: '"gato" OR (', limit: 5 })).not.toThrow();
		expect(seeded().search({ channelId: "c1", text: '"gato"', limit: 5 }).map((h) => h.body)).toEqual([
			"alguém viu meu gato?",
		]);
	});

	it("acha por pergunta em linguagem natural e por plural", () => {
		const store = seeded();
		expect(store.search({ channelId: "c1", text: "qual era o gato da ana?", limit: 5 }).map((h) => h.body)).toEqual([
			"alguém viu meu gato?",
		]);
		expect(store.search({ channelId: "c1", text: "gatos", limit: 5 }).map((h) => h.body)).toEqual([
			"alguém viu meu gato?",
		]);
	});

	it("nada encontrado e lista vazia", () => {
		expect(seeded().search({ channelId: "c1", text: "zzz-nunca", limit: 5 })).toEqual([]);
	});
}
