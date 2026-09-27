import type { ReplyTarget } from "../../application/reply-to-message.ts";

/** Registra tudo que o caso de uso fez com o destino, em ordem. */
export class FakeReplyTarget implements ReplyTarget {
	readonly events: string[] = [];
	readonly delivered: string[][] = [];
	readonly failures: string[] = [];

	async whileWorking<T>(work: () => Promise<T>): Promise<T> {
		this.events.push("working:start");
		try {
			return await work();
		} finally {
			this.events.push("working:end");
		}
	}

	async deliver(chunks: readonly string[]): Promise<void> {
		this.events.push("deliver");
		this.delivered.push([...chunks]);
	}

	async fail(message: string): Promise<void> {
		this.events.push("fail");
		this.failures.push(message);
	}
}
