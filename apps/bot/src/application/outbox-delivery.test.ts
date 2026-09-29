import { describe, expect, it } from "bun:test";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeOutbox } from "../test-support/fakes/outbox.ts";
import { OutboxDelivery } from "./outbox-delivery.ts";

describe("OutboxDelivery", () => {
	it("envia ate 3 arquivos e descarta cada um", async () => {
		const outbox = new FakeOutbox();
		for (const n of ["a", "b", "c", "d"]) outbox.put("c1", `${n}.mp4`);
		const sent: string[] = [];
		await new OutboxDelivery(outbox, new FakeLogger()).deliver("c1", async (p) => void sent.push(p));
		expect(sent.map((p) => p.split("/").pop())).toEqual(["a.mp4", "b.mp4", "c.mp4"]);
		expect(outbox.discarded).toEqual(sent);
	});

	it("falha no envio descarta o arquivo, avisa e para", async () => {
		const outbox = new FakeOutbox();
		outbox.put("c1", "a.mp4");
		outbox.put("c1", "b.mp4");
		const logger = new FakeLogger();
		await new OutboxDelivery(outbox, logger).deliver("c1", async () => {
			throw new Error("grande demais");
		});
		expect(outbox.discarded).toHaveLength(1);
		expect(logger.lines).toEqual(["warn anexo ERRO canal=c1: grande demais"]);
	});

	it("canal sem arquivo nao envia nada", async () => {
		let sent = 0;
		await new OutboxDelivery(new FakeOutbox(), new FakeLogger()).deliver("c1", async () => void sent++);
		expect(sent).toBe(0);
	});
});
