import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { HistoryHit, HistoryQuery, HistorySearch } from "../../../application/ports/history-search.ts";
import type { MessageStore } from "../../../application/ports/message-store.ts";
import type { NewMessage, StoredMessage } from "../../../domain/message.ts";

interface Row {
	rowid: number;
	channel_id: string;
	author_id: string;
	author_name: string;
	message_id: string;
	body: string;
	reply_to: string | null;
	created_at: string;
}

const COLUMNS = "rowid, channel_id, author_id, author_name, message_id, body, reply_to, created_at";

const toMessage = (r: Row): StoredMessage => ({
	seq: r.rowid,
	channelId: r.channel_id,
	authorId: r.author_id,
	authorName: r.author_name,
	messageId: r.message_id,
	body: r.body,
	replyTo: r.reply_to,
	createdAt: r.created_at,
});

/** Termos entre aspas, AND implicito: sintaxe FTS invalida do usuario nao quebra. */
function ftsQuery(text: string): string {
	return text
		.split(/\s+/)
		.map((t) => t.replace(/"/g, '""'))
		.filter(Boolean)
		.map((t) => `"${t}"`)
		.join(" ");
}

/** Tabela `messages` + indice FTS5 `messages_fts` (triggers na migracao v1). */
export class SqliteMessageStore implements MessageStore, HistorySearch {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	append(message: NewMessage): StoredMessage | undefined {
		const result = this.db
			.prepare(
				`INSERT OR IGNORE INTO messages (channel_id, author_id, author_name, message_id, body, reply_to, created_at)
         VALUES (?,?,?,?,?,?,COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')));`,
			)
			.run(
				message.channelId,
				message.authorId,
				message.authorName,
				message.messageId,
				message.body,
				message.replyTo ?? null,
				message.createdAt ?? null,
			);
		if (result.changes === 0) return undefined;
		const row = this.db.prepare(`SELECT ${COLUMNS} FROM messages WHERE message_id = ?;`).get(message.messageId);
		return toMessage(row as unknown as Row);
	}

	listChannel(channelId: string, limit: number): StoredMessage[] {
		return this.rows(`SELECT ${COLUMNS} FROM messages WHERE channel_id = ? ORDER BY rowid LIMIT ?;`, channelId, limit);
	}

	deleteChannel(channelId: string): void {
		this.db.prepare("DELETE FROM messages WHERE channel_id = ?;").run(channelId);
	}

	after(channelId: string, afterSeq: number, limit: number): StoredMessage[] {
		return this.rows(
			`SELECT ${COLUMNS} FROM messages WHERE channel_id = ? AND rowid > ? ORDER BY rowid LIMIT ?;`,
			channelId,
			afterSeq,
			limit,
		);
	}

	search(query: HistoryQuery): HistoryHit[] {
		const filters: string[] = [];
		const args: SQLInputValue[] = [];
		if (query.days && query.days > 0) {
			filters.push("AND m.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)");
			args.push(`-${Math.floor(query.days)} days`);
		}
		if (query.authorId) {
			filters.push("AND m.author_id = ?");
			args.push(query.authorId);
		}
		const match = ftsQuery(query.text ?? "");
		const hits = match
			? this.rows(
					`SELECT ${COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")} FROM messages_fts f
           JOIN messages m ON m.rowid = f.rowid
           WHERE m.channel_id = ? AND messages_fts MATCH ? ${filters.join(" ")}
           ORDER BY rank LIMIT ?;`,
					query.channelId,
					match,
					...args,
					query.limit,
				)
			: this.rows(
					`SELECT ${COLUMNS.split(", ").map((c) => `m.${c}`).join(", ")} FROM messages m
           WHERE m.channel_id = ? ${filters.join(" ")} ORDER BY m.rowid DESC LIMIT ?;`,
					query.channelId,
					...args,
					query.limit,
				).reverse();
		return hits.map((h) => ({
			authorName: h.authorName,
			body: h.body,
			createdAt: h.createdAt,
			context: this.db
				.prepare(
					"SELECT author_name, body FROM messages WHERE channel_id = ? AND rowid BETWEEN ? AND ? AND rowid <> ? ORDER BY rowid LIMIT 4;",
				)
				.all(query.channelId, h.seq - 2, h.seq + 2, h.seq)
				.map((r) => {
					const row = r as { author_name: string; body: string };
					return { authorName: row.author_name, body: row.body };
				}),
		}));
	}

	private rows(sql: string, ...args: SQLInputValue[]): StoredMessage[] {
		return (this.db.prepare(sql).all(...args) as unknown as Row[]).map(toMessage);
	}
}
