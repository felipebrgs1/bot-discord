import { describe } from "bun:test";
import { historySearchContract, messageStoreContract } from "../../../application/ports/message-store.contract.ts";
import { openDatabase } from "./db.ts";
import { SqliteMessageStore } from "./message-store.ts";

describe("SqliteMessageStore", () => {
	messageStoreContract(() => new SqliteMessageStore(openDatabase(":memory:")));
	historySearchContract(() => new SqliteMessageStore(openDatabase(":memory:")));
});
