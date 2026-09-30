import { expect, it } from "bun:test";
import type { Outbox } from "./outbox.ts";

export interface OutboxHarness {
	outbox: Outbox;
	/** Coloca um arquivo no outbox do canal (como uma tool faria). */
	put(channelId: string, name: string): Promise<void>;
}

export function outboxContract(make: () => Promise<OutboxHarness>): void {
	it("canal sem nada tem lista vazia", async () => {
		const { outbox } = await make();
		expect(await outbox.pending("c-vazio")).toEqual([]);
	});

	it("lista o que foi largado, ignora oculto, e descarta", async () => {
		const { outbox, put } = await make();
		await put("canal-1", "a.mp4");
		await put("canal-1", ".tmp");
		await put("canal-2", "b.mp4");
		const pending = await outbox.pending("canal-1");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.endsWith("a.mp4")).toBe(true);
		await outbox.discard(pending[0] ?? "");
		expect(await outbox.pending("canal-1")).toEqual([]);
		expect(await outbox.pending("canal-2")).toHaveLength(1);
	});

	it("save grava no canal e o arquivo fica pendente", async () => {
		const { outbox } = await make();
		const path = await outbox.save("canal-1", "img.png", "aW1n");
		expect(path.endsWith("img.png")).toBe(true);
		expect(await outbox.pending("canal-1")).toEqual([path]);
		expect(await outbox.pending("canal-2")).toEqual([]);
	});

	it("id de canal nao escapa da pasta", async () => {
		const { outbox } = await make();
		expect(outbox.dirFor("../../etc")).not.toContain("..");
	});
}
