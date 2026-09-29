import { expect, it } from "bun:test";
import { DEFAULT_SOUL } from "../../domain/soul.ts";
import type { SoulStore } from "./soul-store.ts";

export function soulStoreContract(make: () => SoulStore): void {
	it("seed cria a padrao uma vez so", () => {
		const souls = make();
		souls.ensureSeed("corpo padrão");
		souls.ensureSeed("outro");
		expect(souls.get(DEFAULT_SOUL)?.body).toBe("corpo padrão");
	});

	it("canal sem escolha usa a padrao", () => {
		const souls = make();
		souls.ensureSeed("corpo padrão");
		expect(souls.channelSoul("c1")).toBe(DEFAULT_SOUL);
		expect(souls.bodyFor("c1")).toBe("corpo padrão");
	});

	it("setChannel troca so aquele canal", () => {
		const souls = make();
		souls.ensureSeed("corpo padrão");
		souls.save("serio", "corpo sério");
		souls.setChannel("c1", "serio");
		expect(souls.channelSoul("c1")).toBe("serio");
		expect(souls.bodyFor("c1")).toBe("corpo sério");
		expect(souls.bodyFor("c2")).toBe("corpo padrão");
	});

	it("rejeita soul desconhecida no canal", () => {
		const souls = make();
		souls.ensureSeed("x");
		expect(() => souls.setChannel("c1", "fantasma")).toThrow("soul desconhecida");
	});

	it("save normaliza o nome e substitui o corpo", () => {
		const souls = make();
		souls.save("Serio", "v1");
		souls.save("serio", "v2");
		expect(souls.get("serio")?.body).toBe("v2");
		expect(souls.list().map((s) => s.name)).toEqual(["serio"]);
	});

	it("list vem em ordem de nome", () => {
		const souls = make();
		souls.save("zeta", "z");
		souls.save("alfa", "a");
		expect(souls.list().map((s) => s.name)).toEqual(["alfa", "zeta"]);
	});
}
