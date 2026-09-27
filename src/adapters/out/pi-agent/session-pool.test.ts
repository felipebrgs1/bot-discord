import { describe, expect, it } from "bun:test";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Role } from "../../../domain/roles.ts";
import { excludedToolsFor, type SessionFactory, SessionPool } from "./session-pool.ts";

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
