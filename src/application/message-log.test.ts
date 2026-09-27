import { describe, expect, it } from "bun:test";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeMessageStore } from "../test-support/fakes/message-store.ts";
import { MessageLog } from "./message-log.ts";

const base = { channelId: "c1", authorId: "u1", authorName: "ana", messageId: "m1" };

describe("MessageLog.record", () => {
	it("grava a mensagem", () => {
		const store = new FakeMessageStore();
		new MessageLog(store, new FakeLogger()).record({ ...base, body: "oi" });
		expect(store.listChannel("c1", 10).map((m) => m.body)).toEqual(["oi"]);
	});

	it("corta corpo gigante em 4000", () => {
		const store = new FakeMessageStore();
		new MessageLog(store, new FakeLogger()).record({ ...base, body: "x".repeat(5000) });
		expect(store.listChannel("c1", 10)[0]?.body).toHaveLength(4000);
	});

	it("falha do banco nunca quebra quem chamou; vira aviso", () => {
		const store = new FakeMessageStore();
		store.append = () => {
			throw new Error("banco travado");
		};
		const logger = new FakeLogger();
		new MessageLog(store, logger).record({ ...base, body: "oi" });
		expect(logger.lines).toEqual(["warn historico ERRO canal=c1: banco travado"]);
	});
});
