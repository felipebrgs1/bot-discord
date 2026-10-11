import { expect, it } from "bun:test";
import type { MemoryAdmin } from "./memory-admin.ts";
import type { MemoryStore } from "./memory-store.ts";

const group = (ownerId: string) => ({ scope: "group" as const, ownerId });
const user = (ownerId: string) => ({ scope: "user" as const, ownerId });

export function memoryStoreContract(make: () => MemoryStore & MemoryAdmin): void {
	it("bloco nunca escrito e vazio", () => {
		expect(make().read(group("c1"))).toEqual([]);
	});

	it("write troca o bloco inteiro, na ordem", () => {
		const store = make();
		store.write(group("c1"), ["a", "b"], "add");
		store.write(group("c1"), ["b", "c"], "replace");
		expect(store.read(group("c1"))).toEqual(["b", "c"]);
	});

	it("blocos de grupo e de pessoa com o mesmo dono nao se misturam", () => {
		const store = make();
		store.write(group("x"), ["do grupo"], "add");
		store.write(user("x"), ["da pessoa"], "add");
		expect(store.read(group("x"))).toEqual(["do grupo"]);
		expect(store.read(user("x"))).toEqual(["da pessoa"]);
	});

	it("cada write vira versao com o motivo", () => {
		const store = make();
		store.write(user("u1"), ["joga LoL"], "tool: add");
		store.write(user("u1"), ["largou o LoL"], "revisão: replace");
		expect(store.versions("user", "u1").map((v) => [v.entries, v.reason])).toEqual([
			[["joga LoL"], "tool: add"],
			[["largou o LoL"], "revisão: replace"],
		]);
		expect(store.versions("group", "u1")).toEqual([]);
	});

	it("lista os blocos escritos, grupo antes de pessoa", () => {
		const store = make();
		store.write(user("u1"), ["joga LoL"], "add");
		store.write(group("c1"), ["sextou"], "add");
		expect(store.blocks().map((b) => [b.scope, b.ownerId, b.entries])).toEqual([
			["group", "c1", ["sextou"]],
			["user", "u1", ["joga LoL"]],
		]);
	});

	it("timeline mostra as escritas, mais novas primeiro", () => {
		const store = make();
		store.write(group("c1"), ["sextou"], "tool: add");
		store.write(user("u1"), ["joga LoL"], "revisão: add");
		expect(store.timeline(10).map((e) => [e.kind, e.detail])).toEqual([
			["memory", "revisão: add"],
			["memory", "tool: add"],
		]);
	});

	it("cursor comeca em 0 e e por canal", () => {
		const store = make();
		expect(store.cursor("c1")).toBe(0);
		store.setCursor("c1", 7);
		expect(store.cursor("c1")).toBe(7);
		expect(store.cursor("c2")).toBe(0);
	});
}
