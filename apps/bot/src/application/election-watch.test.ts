import { describe, expect, it } from "bun:test";
import type { AreaTally } from "@/domain/election.ts";
import { FakeClock } from "@/test-support/fakes/clock.ts";
import { FakeConfigStore } from "@/test-support/fakes/config-store.ts";
import { FakeElectionResults } from "@/test-support/fakes/election-results.ts";
import { FakeLogger } from "@/test-support/fakes/logger.ts";
import { ElectionWatch } from "./election-watch.ts";

const MIN = 60_000;
// 19:00 em Sao Paulo.
const T0 = Date.parse("2026-10-25T22:00:00.000Z");

const tally = (area: string, sectionsPct = "50,00"): AreaTally => ({
	area,
	updatedAt: "25/10/2026 18:59:00",
	sectionsPct,
	candidates: [
		{ number: "13", name: "LULA", votes: 10, pct: "52,63", elected: false },
		{ number: "22", name: "FLAVIO BOLSONARO", votes: 9, pct: "47,37", elected: false },
	],
	blank: 1,
	nulls: 2,
});

function setup(opts: { enabled?: boolean; published?: boolean } = {}) {
	const config = new FakeConfigStore({ election: { enabled: opts.enabled ?? true, channel_id: "c1" } });
	const results = new FakeElectionResults();
	if (opts.published ?? true) {
		results.areas.set("br", tally("br"));
		results.areas.set("zz", tally("zz"));
		results.areas.set("sp", tally("sp"));
	}
	const clock = new FakeClock(T0);
	const logger = new FakeLogger();
	const posts: [string, readonly string[]][] = [];
	const threads: [string, string, readonly string[]][] = [];
	const watch = new ElectionWatch({
		results,
		config,
		clock,
		logger,
		post: async (channelId, chunks) => void posts.push([channelId, chunks]),
		openThread: async (channelId, name, chunks) => void threads.push([channelId, name, chunks]),
	});
	return { watch, config, results, clock, logger, posts, threads };
}

describe("ElectionWatch", () => {
	it("ligado: posta o resumo (total e exterior) no canal e abre a thread por estado", async () => {
		const { watch, results, posts, threads } = setup();
		await watch.tick();
		expect(posts).toHaveLength(1);
		const [channelId, chunks] = posts[0] ?? [];
		expect(channelId).toBe("c1");
		expect(chunks?.join("\n")).toContain("**Total (Brasil + exterior)**: 50,00%");
		expect(chunks?.join("\n")).toContain("**Exterior**");
		expect(threads).toHaveLength(1);
		const [threadChannel, name, lines] = threads[0] ?? [];
		expect(threadChannel).toBe("c1");
		expect(name).toBe("Apuração por estado: 25/10 19:00");
		expect(lines?.join("\n")).toContain("**SP** (50,00% apurado): LULA 52,63% · FLAVIO BOLSONARO 47,37%");
		expect(lines?.join("\n")).toContain("**AC**: sem dados ainda");
		expect(results.requested.filter((a) => a !== "br" && a !== "zz")).toHaveLength(27);
		expect(results.refs[0]).toEqual({ cycle: "ele2026", code: "6258" });
	});

	it("resumo a cada 30 min e thread a cada 1h", async () => {
		const { watch, clock, posts, threads } = setup();
		await watch.tick();
		clock.advance(29 * MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([1, 1]);
		clock.advance(MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([2, 1]);
		clock.advance(30 * MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([3, 2]);
	});

	it("desligado nao busca nem posta", async () => {
		const { watch, results, posts, threads } = setup({ enabled: false });
		await watch.tick();
		expect(results.requested).toEqual([]);
		expect([posts.length, threads.length]).toEqual([0, 0]);
	});

	it("TSE ainda sem resultado: nao posta e tenta no proximo tick", async () => {
		const { watch, results, clock, posts, threads } = setup({ published: false });
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([0, 0]);
		results.areas.set("br", tally("br"));
		clock.advance(MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([1, 1]);
		expect(posts[0]?.[1].join("\n")).not.toContain("Exterior");
	});

	it("arquivo publicado com 0% das secoes (antes de fechar a votacao) conta como sem resultado", async () => {
		const { watch, results, posts, threads } = setup();
		results.areas.set("br", tally("br", "0,00"));
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([0, 0]);
	});

	it("falha no total vira log e tenta no proximo tick", async () => {
		const { watch, results, clock, logger, posts } = setup();
		results.failing.add("br");
		await watch.tick();
		expect(posts).toEqual([]);
		expect(logger.lines.some((l) => l.startsWith("warn") && l.includes("TSE caiu"))).toBe(true);
		results.failing.clear();
		clock.advance(MIN);
		await watch.tick();
		expect(posts).toHaveLength(1);
	});

	it("estado que falha aparece como sem dados, os outros seguem", async () => {
		const { watch, results, threads } = setup();
		results.failing.add("sp");
		await watch.tick();
		expect(threads[0]?.[2].join("\n")).toContain("**SP**: sem dados ainda");
	});

	it("religado posta na hora, sem esperar o intervalo", async () => {
		const { watch, config, clock, posts, threads } = setup();
		await watch.tick();
		config.set("election.enabled", false);
		clock.advance(5 * MIN);
		await watch.tick();
		config.set("election.enabled", true);
		clock.advance(MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([2, 2]);
	});

	it("apuracao em 100%: posta o resultado final, a thread final e se desliga", async () => {
		const { watch, results, clock, config, posts, threads } = setup();
		await watch.tick();
		results.areas.set("br", tally("br", "100,00"));
		clock.advance(10 * MIN);
		await watch.tick();
		expect([posts.length, threads.length]).toEqual([3, 2]);
		expect(posts[2]?.[1].join("\n")).toContain("apuração encerrada");
		expect(config.all().election.enabled).toBe(false);
	});

	it("falha no envio vira log e nao derruba o tick", async () => {
		const { results, config, clock, logger } = setup();
		const watch = new ElectionWatch({
			results,
			config,
			clock,
			logger,
			post: async () => {
				throw new Error("sem permissao");
			},
			openThread: async () => {
				throw new Error("sem permissao de thread");
			},
		});
		await watch.tick();
		expect(logger.lines.filter((l) => l.startsWith("warn") && l.includes("sem permissao"))).toHaveLength(2);
	});
});
