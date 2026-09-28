import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Role } from "../../../domain/roles.ts";
import { botResourceLoader, excludedToolsFor, type SessionFactory, SessionPool } from "./session-pool.ts";

function stubSession(answer: string, calls: unknown[][] = []): AgentSession {
	return {
		prompt: async (...a: unknown[]) => void calls.push(a),
		waitForIdle: async () => undefined,
		getLastAssistantText: () => answer,
		dispose: () => undefined,
	} as unknown as AgentSession;
}

function stubFactory() {
	const created: { conversation: string; role: Role; systemPrompt?: string }[] = [];
	const disposed: AgentSession[] = [];
	const factory: SessionFactory = {
		async create(conversation, role, systemPrompt) {
			created.push({ conversation, role, systemPrompt });
			return stubSession(`resposta-${conversation}`);
		},
		dispose: (s) => void disposed.push(s),
	};
	return { created, disposed, factory };
}

describe("excludedToolsFor", () => {
	it("admin ve tudo; user nao encosta em shell nem arquivo", () => {
		expect(excludedToolsFor("admin")).toEqual([]);
		expect(excludedToolsFor("user")).toEqual(["bash", "powershell", "edit", "write", "read", "grep", "find", "ls"]);
	});
});

describe("SessionPool", () => {
	it("reusa a sessao da conversa e so passa o prompt extra na criacao", async () => {
		const { created, factory } = stubFactory();
		const pool = new SessionPool(factory, 60_000);
		const a = await pool.get("c1", "user", "soul v1");
		const b = await pool.get("c1", "user", "soul v2");
		expect(a).toBe(b);
		expect(created).toEqual([{ conversation: "c1", role: "user", systemPrompt: "soul v1" }]);
	});

	it("isola por papel: user nunca reusa sessao de admin", async () => {
		const { created, factory } = stubFactory();
		const pool = new SessionPool(factory, 60_000);
		expect(await pool.get("c1", "user")).not.toBe(await pool.get("c1", "admin"));
		expect(created.map((c) => c.role)).toEqual(["user", "admin"]);
		expect(pool.conversations()).toEqual(["c1"]);
	});

	it("ask manda texto e imagens e devolve o texto final", async () => {
		const calls: unknown[][] = [];
		const pool = new SessionPool(stubFactory().factory);
		const session = stubSession("oi de volta", calls);
		expect(await pool.ask(session, "olha", [{ type: "image", data: "AAA", mimeType: "image/png" }])).toBe("oi de volta");
		await pool.ask(session, "só texto", []);
		expect(calls).toEqual([
			["olha", { images: [{ type: "image", data: "AAA", mimeType: "image/png" }] }],
			["só texto", undefined],
		]);
	});

	it("forget derruba as sessoes da conversa (todos os papeis)", async () => {
		const { disposed, factory } = stubFactory();
		const pool = new SessionPool(factory, 60_000);
		await pool.get("c1", "user");
		await pool.get("c1", "admin");
		await pool.get("c2", "user");
		pool.forget("c1");
		expect(disposed).toHaveLength(2);
		expect(pool.conversations()).toEqual(["c2"]);
	});

	it("descarta sessao ociosa", async () => {
		let now = 0;
		const { created, factory } = stubFactory();
		const pool = new SessionPool(factory, 5, () => now);
		await pool.get("c1", "user");
		now = 10;
		await pool.get("c2", "user");
		expect(pool.size()).toBe(1);
		await pool.get("c1", "user");
		expect(created.map((c) => c.conversation)).toEqual(["c1", "c2", "c1"]);
	});

	it("dispose derruba tudo", async () => {
		const pool = new SessionPool(stubFactory().factory);
		await pool.get("c1", "user");
		pool.dispose();
		expect(pool.size()).toBe(0);
	});
});

describe("SessionPool: idade maxima", () => {
	it("recria a sessao depois da idade maxima mesmo em uso (memoria do grupo atualiza)", async () => {
		const { created, disposed, factory } = stubFactory();
		let now = 0;
		const pool = new SessionPool(factory, 60_000, () => now, 180_000);
		const first = await pool.get("c1", "user", "grupo v1");
		for (const t of [50_000, 100_000, 150_000]) {
			now = t;
			expect(await pool.get("c1", "user", "grupo v2")).toBe(first);
		}
		now = 200_000;
		const second = await pool.get("c1", "user", "grupo v3");
		expect(second).not.toBe(first);
		expect(disposed).toEqual([first]);
		expect(created.map((c) => c.systemPrompt)).toEqual(["grupo v1", "grupo v3"]);
	});
});

describe("botResourceLoader", () => {
	function workspace() {
		const cwd = mkdtempSync(join(tmpdir(), "bot-cwd-"));
		const agentDir = mkdtempSync(join(tmpdir(), "bot-agent-"));
		writeFileSync(join(cwd, "AGENTS.md"), "TDD obrigatorio");
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "SYSTEM.md"), "prompt do repo");
		writeFileSync(join(agentDir, "AGENTS.md"), "regras globais do dono");
		mkdirSync(join(agentDir, "skills", "wrangler"), { recursive: true });
		writeFileSync(join(agentDir, "skills", "wrangler", "SKILL.md"), "---\nname: wrangler\ndescription: deploy\n---\ncorpo");
		return { cwd, agentDir };
	}

	it("nao carrega AGENTS.md, SYSTEM.md nem skills da maquina", async () => {
		const loader = botResourceLoader({ ...workspace(), personality: "sou o elmatadore" });
		await loader.reload();
		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);
		expect(loader.getSystemPrompt()).toBe("sou o elmatadore");
	});

	it("personalidade e a base e a soul do canal entra como complemento", async () => {
		const loader = botResourceLoader({ ...workspace(), personality: "sou o elmatadore", extra: "soul do canal" });
		await loader.reload();
		expect(loader.getSystemPrompt()).toBe("sou o elmatadore");
		expect(loader.getAppendSystemPrompt()).toEqual(["soul do canal"]);
	});
});
