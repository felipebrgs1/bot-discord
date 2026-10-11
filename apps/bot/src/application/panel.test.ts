import { describe, expect, it } from "bun:test";
import { MEMORY_LIMITS } from "@/domain/memory.ts";
import { DEFAULT_SOUL } from "@/domain/soul.ts";
import { FakeConfigStore } from "@/test-support/fakes/config-store.ts";
import { FakeMemoryStore } from "@/test-support/fakes/memory-store.ts";
import { FakeMetrics } from "@/test-support/fakes/metrics.ts";
import { FakeSoulStore } from "@/test-support/fakes/soul-store.ts";
import { AgentMemory } from "./agent-memory.ts";
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
		memory: new AgentMemory(memories),
		metrics: new FakeMetrics(),
		logs,
		agentModel,
	});
	memories.write({ scope: "group", ownerId: "c1" }, ["joga Terraria"], "revisão: add");
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
	it("lista os blocos com uso e teto do escopo", () => {
		expect(setup().panel.memoryBlocks()).toEqual([
			expect.objectContaining({ scope: "group", ownerId: "c1", entries: ["joga Terraria"], size: 13, limit: MEMORY_LIMITS.group }),
		]);
	});

	it("salvar troca o bloco inteiro com motivo padrao e entra nas versoes", () => {
		const { panel } = setup();
		expect(panel.saveMemory("group", "c1", ["joga Stardew", ""])).toEqual({ ok: true, entries: ["joga Stardew"] });
		expect(panel.memoryVersions("group", "c1").map((v) => [v.entries, v.reason])).toEqual([
			[["joga Terraria"], "revisão: add"],
			[["joga Stardew"], "editado pelo painel"],
		]);
	});

	it("salvar acima do teto e erro e nao muda nada", () => {
		const { panel } = setup();
		expect(panel.saveMemory("user", "u1", ["a".repeat(MEMORY_LIMITS.user + 1)]).ok).toBe(false);
		expect(panel.memoryVersions("user", "u1")).toEqual([]);
	});

	it("learnings traz a linha do tempo", () => {
		expect(setup().panel.learnings().map((e) => e.detail)).toEqual(["revisão: add"]);
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
