import { describe, expect, it } from "bun:test";
import { FakeChatAgent } from "../test-support/fakes/chat-agent.ts";
import { FakeClock } from "../test-support/fakes/clock.ts";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeReplyTarget } from "../test-support/fakes/reply-target.ts";
import type { Turn } from "./persona.ts";
import { type IncomingMessage, type ReplySettings, ReplyToMessage } from "./reply-to-message.ts";

function setup(settings: Partial<ReplySettings> = {}, turnText: (turn: Turn) => string = (turn) => turn.text) {
	const agent = new FakeChatAgent();
	const clock = new FakeClock(100_000);
	const logger = new FakeLogger();
	const replies = new ReplyToMessage({
		agent,
		clock,
		logger,
		settings: () => ({ cooldownMs: 0, adminIds: [], ...settings }),
		systemPromptFor: (channelId) => `persona ${channelId}`,
		turnText,
	});
	return { agent, clock, logger, replies };
}

const msg = (over: Partial<IncomingMessage> = {}): IncomingMessage => ({
	channelId: "c1",
	authorId: "u1",
	authorName: "Ana",
	messageId: "m1",
	text: "oi",
	images: [],
	...over,
});

/** Promessa que o teste resolve na mao: segura o agente "pensando". */
function gate() {
	let open: () => void = () => undefined;
	const opened = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { opened, open };
}

describe("ReplyToMessage: resposta", () => {
	it("pergunta ao agente com o texto do turno (quem fala) e entrega a resposta, com indicador de trabalho em volta", async () => {
		const { agent, replies } = setup({}, (turn) => `[${turn.authorName}/${turn.messageId}] ${turn.text}`);
		const target = new FakeReplyTarget();
		const image = { data: "AAA", mimeType: "image/png" };
		expect(replies.submit(msg({ text: "tudo bem?", images: [image] }), target)).toBe(true);
		await replies.idle();
		expect(agent.requests).toEqual([
			{
				channelId: "c1",
				authorId: "u1",
				role: "user",
				text: "[Ana/m1] tudo bem?",
				images: [image],
				source: "discord",
				systemPrompt: "persona c1",
			},
		]);
		expect(target.delivered).toEqual([["eco: [Ana/m1] tudo bem?"]]);
		expect(target.events).toEqual(["working:start", "working:end", "deliver"]);
	});

	it("autor em adminIds pergunta como admin", async () => {
		const { agent, replies } = setup({ adminIds: ["dono"] });
		replies.submit(msg({ authorId: "dono" }), new FakeReplyTarget());
		await replies.idle();
		expect(agent.requests[0]?.role).toBe("admin");
	});

	it("resposta longa chega em pedacos de ate 2000 caracteres", async () => {
		const { agent, replies } = setup();
		agent.answer = async () => "x".repeat(2500);
		const target = new FakeReplyTarget();
		replies.submit(msg(), target);
		await replies.idle();
		expect(target.delivered[0]?.map((c) => c.length)).toEqual([2000, 500]);
	});

	it("erro do agente vira falha com a mensagem, sem entrega", async () => {
		const { agent, logger, replies } = setup();
		agent.answer = async () => {
			throw new Error("quebrou");
		};
		const target = new FakeReplyTarget();
		replies.submit(msg(), target);
		await replies.idle();
		expect(target.failures).toEqual(["falhei aqui: quebrou"]);
		expect(target.delivered).toEqual([]);
		expect(logger.lines.some((l) => l.startsWith("warn") && l.includes("quebrou"))).toBe(true);
	});

	it("erro ao entregar tambem vira falha", async () => {
		const { replies } = setup();
		const target = new FakeReplyTarget();
		target.deliver = async () => {
			throw new Error("sem permissao");
		};
		replies.submit(msg(), target);
		await replies.idle();
		expect(target.failures).toEqual(["falhei aqui: sem permissao"]);
	});
});

describe("ReplyToMessage: cooldown", () => {
	it("primeira resposta do canal nao espera; a seguinte espera o que falta", async () => {
		const { clock, replies } = setup({ cooldownMs: 4_000 });
		replies.submit(msg(), new FakeReplyTarget());
		await replies.idle();
		clock.advance(1_000);
		replies.submit(msg(), new FakeReplyTarget());
		await replies.idle();
		expect(clock.sleeps).toEqual([3_000]);
	});

	it("resposta que falhou nao conta para o cooldown", async () => {
		const { agent, clock, replies } = setup({ cooldownMs: 4_000 });
		agent.answer = async () => {
			throw new Error("x");
		};
		replies.submit(msg(), new FakeReplyTarget());
		await replies.idle();
		replies.submit(msg(), new FakeReplyTarget());
		await replies.idle();
		expect(clock.sleeps).toEqual([]);
	});

	it("cada canal tem seu cooldown", async () => {
		const { clock, replies } = setup({ cooldownMs: 4_000 });
		replies.submit(msg({ channelId: "c1" }), new FakeReplyTarget());
		await replies.idle();
		replies.submit(msg({ channelId: "c2" }), new FakeReplyTarget());
		await replies.idle();
		expect(clock.sleeps).toEqual([]);
	});
});

describe("ReplyToMessage: fila por canal", () => {
	it("responde uma de cada vez, na ordem de chegada", async () => {
		const { agent, replies } = setup();
		const first = gate();
		const order: string[] = [];
		agent.answer = async (r) => {
			order.push(`inicio ${r.text}`);
			if (r.text === "1") await first.opened;
			order.push(`fim ${r.text}`);
			return r.text;
		};
		replies.submit(msg({ text: "1" }), new FakeReplyTarget());
		replies.submit(msg({ text: "2" }), new FakeReplyTarget());
		await Promise.resolve();
		expect(order).toEqual(["inicio 1"]);
		first.open();
		await replies.idle();
		expect(order).toEqual(["inicio 1", "fim 1", "inicio 2", "fim 2"]);
	});

	it("com uma em andamento, aceita mais 8 e descarta o resto", async () => {
		const { agent, replies } = setup();
		const hold = gate();
		agent.answer = async (r) => {
			await hold.opened;
			return r.text;
		};
		const accepted = Array.from({ length: 10 }, (_, i) => replies.submit(msg({ text: `${i}` }), new FakeReplyTarget()));
		expect(accepted).toEqual([true, true, true, true, true, true, true, true, true, false]);
		hold.open();
		await replies.idle();
		expect(agent.requests.map((r) => r.text)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
	});

	it("canal ocupado nao segura outro canal", async () => {
		const { agent, replies } = setup();
		const hold = gate();
		agent.answer = async (r) => {
			if (r.channelId === "c1") await hold.opened;
			return r.text;
		};
		const busy = new FakeReplyTarget();
		const free = new FakeReplyTarget();
		replies.submit(msg({ channelId: "c1" }), busy);
		replies.submit(msg({ channelId: "c2" }), free);
		await new Promise((r) => setTimeout(r, 0));
		expect(free.delivered).toHaveLength(1);
		expect(busy.delivered).toHaveLength(0);
		hold.open();
		await replies.idle();
		expect(busy.delivered).toHaveLength(1);
	});

	it("stop descarta o que esta na fila", async () => {
		const { agent, replies } = setup();
		const hold = gate();
		agent.answer = async (r) => {
			await hold.opened;
			return r.text;
		};
		replies.submit(msg({ text: "a" }), new FakeReplyTarget());
		replies.submit(msg({ text: "b" }), new FakeReplyTarget());
		replies.stop();
		hold.open();
		await replies.idle();
		expect(agent.requests.map((r) => r.text)).toEqual(["a"]);
	});
});
