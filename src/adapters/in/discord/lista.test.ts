import { describe, expect, it } from "bun:test";
import { colorForGame, listaEmbed, magnetRow } from "./lista.ts";

const hits = [
	{ title: "The Sims 4 v1.2.3", url: "https://s/4", cover: "https://s/capa.jpg" },
	{ title: "The Sims 3", url: "https://s/3" },
	{ title: "The Sims 2", url: "https://s/2" },
];

describe("listaEmbed", () => {
	it("titulo com emoji, capa grande, 3 fields com link, footer e timestamp", () => {
		const embed = listaEmbed("The Sims 4", hits).toJSON();
		expect(embed.title).toBe("🎮 The Sims 4");
		expect(embed.image?.url).toBe("https://s/capa.jpg");
		expect(embed.thumbnail).toBeUndefined();
		expect(embed.description).toBeUndefined();
		expect(embed.fields).toHaveLength(3);
		expect(embed.fields?.[0]).toEqual({ name: "1. The Sims 4 v1.2.3", value: "[🔗 Ver página](https://s/4)" });
		expect(embed.footer?.text).toBe("Top 3 · Skidrow Reloaded");
		expect(embed.timestamp).toBeTruthy();
	});

	it("footer conta a correcao do nome", () => {
		expect(listaEmbed("The Sims 4", hits, "thesims").toJSON().footer?.text).toBe(
			"Corrigido: thesims → The Sims 4 · Top 3 · Skidrow Reloaded",
		);
	});
});

describe("colorForGame", () => {
	it("deterministica, varia por jogo e nunca e o cinza padrao", () => {
		const a = colorForGame("The Sims 4");
		expect(colorForGame("The Sims 4")).toBe(a);
		expect(a).not.toBe(colorForGame("Forza Horizon 6"));
		expect(a).not.toBe(0x2b2d31);
	});
});

describe("magnetRow", () => {
	it("um botao por hit (ate 3); sem hit, nenhuma linha", () => {
		expect(magnetRow(0)).toEqual([]);
		const [row] = magnetRow(5).map((r) => r.toJSON());
		expect(row?.components.map((c) => ("custom_id" in c ? c.custom_id : ""))).toEqual(["skr:0", "skr:1", "skr:2"]);
	});
});
