import type { HistoryHit, HistoryQuery, HistorySearch } from "../../application/ports/history-search.ts";
import type { MessageStore } from "../../application/ports/message-store.ts";
import type { NewMessage, StoredMessage } from "../../domain/message.ts";
import { searchTerms } from "../../domain/search-terms.ts";
import { matchCount } from "./search.ts";

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
			fromBot: message.fromBot ?? false,
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

	sinceLastBotMessage(channelId: string, limit: number): StoredMessage[] {
		const all = this.channel(channelId);
		const lastBot = all.findLastIndex((m) => m.fromBot);
		return all.slice(lastBot + 1).slice(-limit);
	}

	search(query: HistoryQuery): HistoryHit[] {
		const text = query.text ?? "";
		let pool = this.channel(query.channelId).filter((m) => !query.authorId || m.authorId === query.authorId);
		if (searchTerms(text).length > 0) {
			pool = pool
				.map((m) => ({ m, n: matchCount(text, m.body) }))
				.filter(({ n }) => n > 0)
				.sort((a, b) => b.n - a.n)
				.map(({ m }) => m);
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
