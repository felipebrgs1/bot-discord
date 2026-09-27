import type { HistoryHit, HistoryQuery, HistorySearch } from "../../application/ports/history-search.ts";
import type { MessageStore } from "../../application/ports/message-store.ts";
import type { NewMessage, StoredMessage } from "../../domain/message.ts";

const words = (s: string): string[] =>
	s
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

export class FakeMessageStore implements MessageStore, HistorySearch {
	readonly messages: StoredMessage[] = [];
	private seq = 0;

	append(message: NewMessage): StoredMessage | undefined {
		if (this.messages.some((m) => m.messageId === message.messageId)) return undefined;
		this.seq += 1;
		const stored: StoredMessage = {
			seq: this.seq,
			channelId: message.channelId,
			authorId: message.authorId,
			authorName: message.authorName,
			messageId: message.messageId,
			body: message.body,
			replyTo: message.replyTo ?? null,
			createdAt: message.createdAt ?? new Date(this.seq * 1000).toISOString(),
		};
		this.messages.push(stored);
		return stored;
	}

	listChannel(channelId: string, limit: number): StoredMessage[] {
		return this.channel(channelId).slice(0, limit);
	}

	deleteChannel(channelId: string): void {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			if (this.messages[i]?.channelId === channelId) this.messages.splice(i, 1);
		}
	}

	after(channelId: string, afterSeq: number, limit: number): StoredMessage[] {
		return this.channel(channelId)
			.filter((m) => m.seq > afterSeq)
			.slice(0, limit);
	}

	search(query: HistoryQuery): HistoryHit[] {
		const terms = words(query.text ?? "");
		let pool = this.channel(query.channelId).filter((m) => !query.authorId || m.authorId === query.authorId);
		if (terms.length > 0) {
			pool = pool.filter((m) => {
				const have = new Set(words(m.body));
				return terms.every((t) => have.has(t));
			});
		} else {
			pool = pool.slice(-query.limit);
		}
		return pool.slice(0, query.limit).map((m) => ({
			authorName: m.authorName,
			body: m.body,
			createdAt: m.createdAt,
			context: this.channel(query.channelId)
				.filter((n) => n.seq !== m.seq && Math.abs(n.seq - m.seq) <= 2)
				.slice(0, 4)
				.map((n) => ({ authorName: n.authorName, body: n.body })),
		}));
	}

	private channel(channelId: string): StoredMessage[] {
		return this.messages.filter((m) => m.channelId === channelId);
	}
}
