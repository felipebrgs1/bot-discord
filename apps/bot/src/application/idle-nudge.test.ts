import { describe, expect, it } from "bun:test";
import { defaultSettings, type NudgeConfig } from "../domain/settings.ts";
import { FakeClock } from "../test-support/fakes/clock.ts";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { FakeSubAgents } from "../test-support/fakes/sub-agents.ts";
import { IdleNudge } from "./idle-nudge.ts";

const MIN = 60_000;
// 15:00 em Sao Paulo: fora do horario de silencio.
const T0 = Date.parse("2026-10-10T18:00:00.000Z");

function setup(opts: { channelIds?: string[]; nudge?: Partial<NudgeConfig> } = {}) {
	const messages = new FakeMessageStore();
	const agent = new FakeSubAgents();
	agent.answer = async () => "e ai, sumiram?";
	const clock = new FakeClock(T0);
	const logger = new FakeLogger();
	const sent: [string, readonly string[]][] = [];
	let sendFails = false;
	const nudge = new IdleNudge({
		messages,
		agents: agent,
		clock,
		logger,
		settings: () => ({
			channelIds: opts.channelIds ?? ["c1"],
			nudge: { ...defaultSettings().nudge, ...opts.nudge },
		}),
		instructionsFor: (channelId) => `voz do bot em ${channelId}`,
		send: async (channelId, chunks) => {
			if (sendFails) throw new Error("sem permissao");
			sent.push([channelId, chunks]);
		},
	});
	const say = (channelId: string, id: string, body: string, ms: number, fromBot = false) =>
		messages.append({
			channelId,
			authorId: fromBot ? "bot" : "ana",
			authorName: fromBot ? "bot" : "ana",
			messageId: id,
			body,
			fromBot,
			createdAt: new Date(ms).toISOString(),
		});
	return { nudge, messages, agent, clock, logger, sent, say, failSend: () => void (sendFails = true) };
}

describe("IdleNudge", () => {
	it("canal parado ha 30 min: pede a um sub-agente sem tools um puxa-assunto e manda no canal", async () => {
		const { nudge, agent, clock, sent, say } = setup();
		say("c1", "m1", "alguem joga hoje?", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toEqual([["c1", ["e ai, sumiram?"]]]);
		const task = agent.tasks[0];
		expect(task?.conversationId).toBe("c1");
		expect(task?.tools).toBe(false);
		expect(task?.instructions).toBe("voz do bot em c1");
		expect(task?.text).toContain("30 minutos");
		expect(task?.text).toContain("ana: alguem joga hoje?");
	});

	it("nao cutuca antes do tempo", async () => {
		const { nudge, clock, sent, say } = setup();
		say("c1", "m1", "oi", T0);
		clock.advance(29 * MIN);
		await nudge.tick();
		expect(sent).toEqual([]);
	});

	it("desligado na config nao cutuca", async () => {
		const { nudge, clock, sent, say } = setup({ nudge: { enabled: false } });
		say("c1", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toEqual([]);
	});

	it("so canais da allowlist", async () => {
		const { nudge, clock, sent, say } = setup({ channelIds: ["c1"] });
		say("c2", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toEqual([]);
	});

	it("usa o tempo de silencio da config", async () => {
		const { nudge, clock, sent, say } = setup({ nudge: { idle_min: 10 } });
		say("c1", "m1", "oi", T0);
		clock.advance(10 * MIN);
		await nudge.tick();
		expect(sent).toHaveLength(1);
	});

	it("uma tentativa por silencio, mesmo antes da propria fala chegar ao historico", async () => {
		const { nudge, clock, sent, say } = setup();
		say("c1", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		clock.advance(MIN);
		await nudge.tick();
		expect(sent).toHaveLength(1);
	});

	it("falha no envio vira log e nao tenta de novo no mesmo silencio", async () => {
		const { nudge, clock, logger, agent, say, failSend } = setup();
		failSend();
		say("c1", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		clock.advance(MIN);
		await nudge.tick();
		expect(agent.tasks).toHaveLength(1);
		expect(logger.lines.some((l) => l.startsWith("warn") && l.includes("sem permissao"))).toBe(true);
	});

	it("resposta vazia do agente nao manda nada", async () => {
		const { nudge, agent, clock, sent, say } = setup();
		agent.answer = async () => "  ";
		say("c1", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toEqual([]);
	});

	it("erro num canal nao impede os outros", async () => {
		const { nudge, agent, clock, sent, say } = setup({ channelIds: ["c1", "c2"] });
		agent.answer = async (r) => {
			if (r.conversationId === "c1") throw new Error("modelo caiu");
			return "bora?";
		};
		say("c1", "m1", "oi", T0);
		say("c2", "m2", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toEqual([["c2", ["bora?"]]]);
	});

	it("humano falou de novo: o proximo silencio pode ser cutucado", async () => {
		const { nudge, clock, sent, say } = setup();
		say("c1", "m1", "oi", T0);
		clock.advance(30 * MIN);
		await nudge.tick();
		say("c1", "m2", "e ai, sumiram?", clock.now(), true);
		say("c1", "m3", "voltei", clock.now() + MIN);
		clock.advance(31 * MIN);
		await nudge.tick();
		expect(sent).toHaveLength(2);
	});

	it("forcado cutuca na hora, mesmo desligado, sem silencio e de madrugada", async () => {
		const madrugada = Date.parse("2026-10-11T06:00:00.000Z"); // 03:00 em Sao Paulo
		const { nudge, agent, clock, sent, say } = setup({ nudge: { enabled: false } });
		clock.advance(madrugada - T0);
		say("c1", "m1", "oi", clock.now());
		await nudge.force("c1");
		expect(sent).toEqual([["c1", ["e ai, sumiram?"]]]);
		expect(agent.tasks[0]?.text).not.toContain("minutos");
	});

	it("forcado propaga a falha para quem pediu", async () => {
		const { nudge, agent } = setup();
		agent.answer = async () => " ";
		await expect(nudge.force("c1")).rejects.toThrow("sem texto");
	});

	it("depois do forcado o automatico nao cutuca o mesmo silencio", async () => {
		const { nudge, clock, sent, say } = setup();
		say("c1", "m1", "!cutucar", T0);
		await nudge.force("c1");
		expect(sent).toHaveLength(1);
		clock.advance(30 * MIN);
		await nudge.tick();
		expect(sent).toHaveLength(1);
	});
});
