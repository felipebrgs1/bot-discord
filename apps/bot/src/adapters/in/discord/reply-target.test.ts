import { describe, expect, it, vi } from "bun:test";
import { discordReplyTarget, trackWorking } from "./reply-target.ts";

function stubMessage() {
	const events: string[] = [];
	const msg = {
		reply: vi.fn(async (c: unknown) => void events.push(`reply ${String(c)}`)),
		react: vi.fn(async (e: string) => void events.push(`react ${e}`)),
		reactions: { cache: new Map([["⏱️", { users: { remove: async (id: string) => void events.push(`unreact ${id}`) } }]]) },
		channel: {
			send: vi.fn(async (c: unknown) => void events.push(`send ${String(c)}`)),
			sendTyping: vi.fn(async () => undefined),
		},
	};
	return { events, msg };
}

describe("trackWorking", () => {
	it("relogio enquanto trabalha, check no fim", async () => {
		const { events, msg } = stubMessage();
		expect(await trackWorking(msg, "bot", async () => "ok")).toBe("ok");
		expect(events).toEqual(["react ⏱️", "unreact bot", "react ✅"]);
	});

	it("erro troca por X e propaga", async () => {
		const { events, msg } = stubMessage();
		await expect(trackWorking(msg, "bot", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
		expect(events).toEqual(["react ⏱️", "unreact bot", "react ❌"]);
	});

	it("reacao que falha nao quebra o trabalho", async () => {
		const { msg } = stubMessage();
		msg.react = vi.fn(async () => Promise.reject(new Error("sem permissão")));
		expect(await trackWorking(msg, "bot", async () => "ok")).toBe("ok");
	});
});

describe("discordReplyTarget", () => {
	it("primeiro pedaco como reply, resto no canal, depois o outbox", async () => {
		const { events, msg } = stubMessage();
		await discordReplyTarget(msg, "bot", async () => void events.push("outbox")).deliver(["a", "b", "c"]);
		expect(events).toEqual(["reply a", "send b", "send c", "outbox"]);
	});

	it("falha drena o outbox e responde o erro", async () => {
		const { events, msg } = stubMessage();
		await discordReplyTarget(msg, "bot", async () => void events.push("outbox")).fail("falhei aqui: x");
		expect(events).toEqual(["outbox", "reply falhei aqui: x"]);
	});

	it("reply de erro que falha nao propaga", async () => {
		const { msg } = stubMessage();
		msg.reply = vi.fn(async () => Promise.reject(new Error("sem permissao")));
		await discordReplyTarget(msg, "bot", async () => undefined).fail("x");
	});
});
