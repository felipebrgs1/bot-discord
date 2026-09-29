import { describe, expect, it } from "bun:test";
import { DEFAULT_SOUL } from "../domain/soul.ts";
import { FakeConfigStore } from "../test-support/fakes/config-store.ts";
import { FakeMemoryStore } from "../test-support/fakes/memory-store.ts";
import { FakeMetrics } from "../test-support/fakes/metrics.ts";
import { FakeSoulStore } from "../test-support/fakes/soul-store.ts";
import { Panel } from "./panel.ts";
import type { LogFeed } from "./ports/log-feed.ts";

function setup(agentModel = "") {
	const config = new FakeConfigStore();
	const souls = new FakeSoulStore();
	const memories = new FakeMemoryStore();
	const forgotten: string[] = [];
	const logCalls: [number, number][] = [];
	const logs: LogFeed = {
		after: (cursor, limit) => {
			logCalls.push([cursor, limit]);
			return { entries: [], cursor: 7 };
		},
	};
	const panel = new Panel({
		config,
		souls,
		sessions: { conversations: () => ["c1", "web:s1"], forget: (c) => void forgotten.push(c) },
		memories,
		metrics: new FakeMetrics(),
		logs,
		agentModel,
	});
	memories.commit("c1", { summary: "", memories: [{ key: "jogo", kind: "fact", scope: "group", personId: "", content: "Terraria" }], forget: [], confirm: [], episodes: [] }, 1);
	return { panel, config, souls, memories, forgotten, logCalls };
}

describe("Panel.meta", () => {
	it("modelo da conversa (AGENT_MODEL ou padrao do pi) e papel do usuario do painel", () => {
		const { panel, config } = setup();
		expect(panel.meta()).toEqual({ model: "(padrão do pi)", role: "user" });
		config.set("discord.admin_ids", ["dono"]);
		config.set("dashboard.web_user_id", "dono");
		expect(panel.meta()).toEqual({ model: "(padrão do pi)", role: "admin" });
		expect(setup("openai-codex/gpt-6-luna").panel.meta().model).toBe("openai-codex/gpt-6-luna");
	});

	it("chat.model do config e o da consolidacao, nao o da conversa", () => {
		const { panel, config } = setup("p/conversa");
		config.set("chat.model", "consolidacao");
		expect(panel.meta().model).toBe("p/conversa");
		expect(panel.model()).toBe("consolidacao");
	});
});

describe("Panel.logs", () => {
	it("limite padrao 300, teto 1000", () => {
		const { panel, logCalls } = setup();
		panel.logs(5);
		panel.logs(0, 5000);
		expect(logCalls).toEqual([
			[5, 300],
			[0, 1000],
		]);
	});
});

describe("Panel: memorias", () => {
	it("forget some da lista com motivo padrao; restore volta", () => {
		const { panel } = setup();
		const id = panel.memories()[0]?.id ?? 0;
		expect(panel.forget(id)).toBe(true);
		expect(panel.memories()).toEqual([]);
		expect(panel.restore(id, "voltou")).toBe(true);
		expect(panel.memoryVersions(id)?.versions.map((v) => v.reason)).toEqual(["consolidação", "esquecido pelo painel", "voltou"]);
	});

	it("restore sem motivo usa o padrao", () => {
		const { panel } = setup();
		const id = panel.memories()[0]?.id ?? 0;
		panel.restore(id);
		expect(panel.memoryVersions(id)?.versions.at(-1)?.reason).toBe("restaurado pelo painel");
	});

	it("correct troca conteudo; vazio e erro; motivo padrao", () => {
		const { panel } = setup();
		const id = panel.memories()[0]?.id ?? 0;
		expect(() => panel.correct(id, "  ")).toThrow("conteúdo vazio");
		expect(panel.correct(id, "Stardew")).toBe(true);
		expect(panel.memories()[0]?.content).toBe("Stardew");
		expect(panel.memoryVersions(id)?.versions.at(-1)?.reason).toBe("corrigido pelo painel");
	});

	it("memoria inexistente", () => {
		const { panel } = setup();
		expect(panel.memoryVersions(999)).toBeUndefined();
		expect(panel.forget(999)).toBe(false);
		expect(panel.correct(999, "x")).toBe(false);
	});

	it("learnings traz a linha do tempo", () => {
		expect(setup().panel.learnings().map((e) => e.subject)).toEqual(["jogo"]);
	});
});

describe("Panel: formulario do Discord", () => {
	it("le config + personalidade da soul padrao (ou do config, sem soul)", () => {
		const { panel, souls } = setup();
		expect(panel.discordForm()).toEqual({
			guild_id: "",
			channel_ids: [],
			admin_ids: [],
			web_user_id: "",
			personality: "Você é um amigo do servidor: direto, bem-humorado, fala PT-BR.",
		});
		souls.ensureSeed("mente padrão");
		expect(panel.discordForm().personality).toBe("mente padrão");
	});

	it("salva discord e usuario web; personalidade nova troca a soul padrao e derruba as sessoes", () => {
		const { panel, souls, forgotten } = setup();
		panel.saveDiscordForm({ guild_id: "g9", channel_ids: ["c9"], admin_ids: ["a9"], web_user_id: "a9", personality: "mente nova" });
		expect(panel.discordForm()).toEqual({ guild_id: "g9", channel_ids: ["c9"], admin_ids: ["a9"], web_user_id: "a9", personality: "mente nova" });
		expect(souls.get(DEFAULT_SOUL)?.body).toBe("mente nova");
		expect(forgotten).toEqual(["c1", "web:s1"]);
	});

	it("sem personalidade nao mexe na soul nem nas sessoes", () => {
		const { panel, forgotten } = setup();
		panel.saveDiscordForm({ guild_id: "g9" });
		expect(forgotten).toEqual([]);
		expect(panel.discordForm().channel_ids).toEqual([]);
	});
});

describe("Panel: modelo", () => {
	it("setModel troca o chat.model", () => {
		const { panel } = setup();
		panel.setModel("x-model");
		expect(panel.model()).toBe("x-model");
	});
});
