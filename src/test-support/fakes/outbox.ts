import type { OutboxHarness } from "../../application/ports/outbox.contract.ts";
import type { Outbox } from "../../application/ports/outbox.ts";

export class FakeOutbox implements Outbox {
	readonly files = new Set<string>();
	readonly discarded: string[] = [];

	dirFor(channelId: string): string {
		return `/outbox/${channelId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
	}

	async pending(channelId: string): Promise<string[]> {
		const dir = `${this.dirFor(channelId)}/`;
		return [...this.files].filter((f) => f.startsWith(dir) && !f.slice(dir.length).startsWith("."));
	}

	async discard(path: string): Promise<void> {
		this.discarded.push(path);
		this.files.delete(path);
	}

	put(channelId: string, name: string): void {
		this.files.add(`${this.dirFor(channelId)}/${name}`);
	}
}

export async function fakeOutboxHarness(): Promise<OutboxHarness> {
	const outbox = new FakeOutbox();
	return { outbox, put: async (channelId, name) => outbox.put(channelId, name) };
}
