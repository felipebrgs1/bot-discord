import { expect, it } from "bun:test";
import type { ExtractedMemory, Extraction } from "../../domain/memory.ts";
import type { MemoryAdmin } from "./memory-admin.ts";
import type { MemoryStore } from "./memory-store.ts";

const mem = (over: Partial<ExtractedMemory> & { key: string; content: string }): ExtractedMemory => ({
	kind: "fact",
	scope: "group",
	personId: "",
	...over,
});

const extraction = (...memories: ExtractedMemory[]): Extraction => ({ summary: "s", memories, forget: [], confirm: [], episodes: [] });
const changes = (over: Partial<Extraction>): Extraction => ({ ...extraction(), ...over });

export function memoryStoreContract(make: () => MemoryStore & MemoryAdmin): void {
	it("cursor comeca em 0 e avanca no commit", () => {
		const store = make();
		expect(store.cursor("c1")).toBe(0);
		store.commit("c1", extraction(), 7);
		expect(store.cursor("c1")).toBe(7);
		expect(store.cursor("c2")).toBe(0);
	});

	it("mesma chave atualiza em vez de duplicar, e cada commit vira versao", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "jogo", content: "Terraria" })), 1);
		store.commit("c1", extraction(mem({ key: "jogo", content: "Stardew" })), 2);
		const all = store.listActive(10);
		expect(all.map((m) => m.content)).toEqual(["Stardew"]);
		expect(all[0]?.versions).toBe(2);
		expect(store.versions(all[0]?.id ?? 0).map((v) => v.content)).toEqual(["Terraria", "Stardew"]);
	});

	it("versoes de pessoas diferentes com a mesma chave nao se misturam", () => {
		const store = make();
		store.commit(
			"c1",
			extraction(
				mem({ key: "jogo", scope: "user", personId: "ana", content: "Terraria" }),
				mem({ key: "jogo", scope: "user", personId: "bruno", content: "LoL" }),
			),
			1,
		);
		store.commit("c1", extraction(mem({ key: "jogo", scope: "user", personId: "ana", content: "Stardew" })), 2);
		const ana = store.listActive(10).find((m) => m.personId === "ana");
		const bruno = store.listActive(10).find((m) => m.personId === "bruno");
		expect(store.versions(ana?.id ?? 0).map((v) => v.content)).toEqual(["Terraria", "Stardew"]);
		expect(store.versions(bruno?.id ?? 0).map((v) => v.content)).toEqual(["LoL"]);
		expect(ana?.versions).toBe(2);
		expect(bruno?.versions).toBe(1);
	});

	it("memoria de pessoa e uma so em todos os canais: mesma key em outro canal atualiza", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "jogo", scope: "user", personId: "u1", content: "Terraria" })), 1);
		store.commit("c2", extraction(mem({ key: "jogo", scope: "user", personId: "u1", content: "Stardew" })), 1);
		const all = store.listActive(10);
		expect(all.map((m) => m.content)).toEqual(["Stardew"]);
		expect(all[0]?.versions).toBe(2);
	});

	it("forget suprime a memoria com o motivo e vira versao", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "lol", scope: "user", personId: "u1", content: "joga LoL" })), 1);
		store.commit("c1", changes({ forget: [{ key: "lol", scope: "user", personId: "u1", reason: "largou" }] }), 2);
		expect(store.listActive(10)).toEqual([]);
		expect(store.familiar("u1", "c1").mine).toEqual([]);
		const id = store.find(1)?.id ?? 0;
		expect(store.versions(id).map((v) => v.reason)).toEqual(["consolidação", "consolidação: largou"]);
	});

	it("reafirmar (confirm ou mesmo conteudo) nao cria versao e sobe no ranking", () => {
		const store = make();
		store.commit(
			"c1",
			extraction(
				mem({ key: "a", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" }),
				mem({ key: "b", kind: "preference", scope: "user", personId: "u1", content: "odeia spoiler" }),
			),
			1,
		);
		store.commit("c1", extraction(mem({ key: "a", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" })), 2);
		store.commit("c1", changes({ confirm: [{ key: "a", scope: "user", personId: "u1" }] }), 3);
		expect(store.familiar("u1", "c1").mine.map((m) => m.content)).toEqual(["ama Terraria", "odeia spoiler"]);
		const a = store.listActive(10).find((m) => m.key === "a");
		expect(a?.versions).toBe(1);
	});

	it("known traz as ativas do grupo do canal e das pessoas pedidas", () => {
		const store = make();
		store.commit(
			"c1",
			extraction(
				mem({ key: "g", kind: "culture", content: "sextou" }),
				mem({ key: "a", scope: "user", personId: "u1", content: "da Ana" }),
				mem({ key: "b", scope: "user", personId: "u2", content: "do Bruno" }),
			),
			1,
		);
		store.commit("c9", extraction(mem({ key: "o", content: "de outro canal" })), 1);
		expect(store.known("c1", ["u1"]).map((m) => m.content).sort()).toEqual(["da Ana", "sextou"]);
	});

	it("episodios sao do canal e entram na busca", () => {
		const store = make();
		store.commit("c1", changes({ episodes: [{ key: "saga", title: "A saga do churrasco", summary: "choveu e ninguem levou carvao" }] }), 1);
		store.commit("c2", changes({ episodes: [{ key: "saga", title: "Outra saga", summary: "carvao no outro canal" }] }), 1);
		expect(store.search("c1", "carvao", 5)).toEqual([
			{ key: "saga", kind: "episode", scope: "group", personId: "", content: "A saga do churrasco: choveu e ninguem levou carvao" },
		]);
	});

	it("familiar junta prefs/licoes da pessoa e prefs/licoes/cultura do grupo no canal", () => {
		const store = make();
		store.commit(
			"c1",
			extraction(
				mem({ key: "a", kind: "preference", scope: "user", personId: "u1", content: "ama Terraria" }),
				mem({ key: "b", kind: "lesson", scope: "user", personId: "u1", content: "não resuma demais" }),
				mem({ key: "c", kind: "fact", scope: "user", personId: "u1", content: "fato vem depois" }),
				mem({ key: "d", kind: "culture", content: "sextou é sagrado" }),
				mem({ key: "e", kind: "preference", scope: "user", personId: "u2", content: "do outro não entra" }),
			),
			1,
		);
		store.commit("c9", extraction(mem({ key: "f", kind: "preference", content: "de outro canal não entra" })), 1);
		const { mine, group } = store.familiar("u1", "c1");
		expect(mine.map((m) => m.content).slice(0, 2).sort()).toEqual(["ama Terraria", "não resuma demais"]);
		expect(mine.at(-1)?.content).toBe("fato vem depois");
		expect(group).toEqual([{ kind: "culture", content: "sextou é sagrado" }]);
	});

	it("search acha ativas do canal; esquecida some e volta ao restaurar", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", kind: "preference", content: "ama Terraria" })), 1);
		store.commit("c2", extraction(mem({ key: "b", content: "Terraria no outro canal" })), 1);
		const hits = store.search("c1", "Terraria", 5);
		expect(hits.map((h) => h.content)).toEqual(["ama Terraria"]);
		const id = store.listActive(10).find((m) => m.key === "a")?.id ?? 0;
		expect(store.setStatus(id, "suppressed", "teste")).toBe(true);
		expect(store.search("c1", "Terraria", 5)).toEqual([]);
		expect(store.listActive(10).map((m) => m.key)).toEqual(["b"]);
		store.setStatus(id, "active", "voltou");
		expect(store.search("c1", "Terraria", 5)).toHaveLength(1);
		expect(store.versions(id).map((v) => v.reason)).toEqual(["consolidação", "teste", "voltou"]);
	});

	it("acha memoria por pergunta em linguagem natural, mais termos em comum primeiro", () => {
		const store = make();
		store.commit(
			"c1",
			extraction(
				mem({ key: "a", content: "gosta de jogo de terror" }),
				mem({ key: "b", content: "o jogo favorito do grupo é Terraria" }),
				mem({ key: "c", content: "sextou é sagrado" }),
			),
			1,
		);
		expect(store.search("c1", "qual é o jogo favorito de vocês?", 5).map((h) => h.key)).toEqual(["b", "a"]);
	});

	it("acha plural e singular pelo prefixo", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", content: "curte jogos de corrida" })), 1);
		expect(store.search("c1", "jogo", 5).map((h) => h.key)).toEqual(["a"]);
		expect(store.search("c1", "corridas", 5).map((h) => h.key)).toEqual(["a"]);
	});

	it("memoria de pessoa aparece na busca de qualquer canal", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", scope: "user", personId: "u1", content: "odeia spoiler" })), 1);
		expect(store.search("c2", "spoiler", 5).map((h) => h.key)).toEqual(["a"]);
	});

	it("busca so com palavras vazias nao devolve nada", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", content: "isso aqui é uma memória" })), 1);
		expect(store.search("c1", "o que é isso", 5)).toEqual([]);
	});

	it("correct troca o conteudo, reativa e versiona", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", content: "Terraria" })), 1);
		const id = store.listActive(10)[0]?.id ?? 0;
		store.setStatus(id, "suppressed", "");
		expect(store.correct(id, "Stardew Valley", "mudou")).toBe(true);
		const found = store.find(id);
		expect(found?.content).toBe("Stardew Valley");
		expect(found?.status).toBe("active");
		expect(found?.versions).toBe(3);
		expect(store.versions(id).at(-1)?.reason).toBe("mudou");
	});

	it("id inexistente: find vazio e alteracoes devolvem false", () => {
		const store = make();
		expect(store.find(999)).toBeUndefined();
		expect(store.setStatus(999, "suppressed", "")).toBe(false);
		expect(store.correct(999, "x", "")).toBe(false);
	});

	it("timeline traz versoes de memoria, mais novas primeiro", () => {
		const store = make();
		store.commit("c1", extraction(mem({ key: "a", content: "x" })), 1);
		store.commit("c1", extraction(mem({ key: "b", content: "y" })), 2);
		const events = store.timeline(10);
		expect(events.map((e) => e.subject)).toEqual(["b", "a"]);
		expect(events[0]).toMatchObject({ kind: "memory", detail: "consolidação" });
	});
}
