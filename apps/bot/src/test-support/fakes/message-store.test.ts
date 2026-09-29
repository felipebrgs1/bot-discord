import { describe } from "bun:test";
import { historySearchContract, messageStoreContract } from "../../application/ports/message-store.contract.ts";
import { FakeMessageStore } from "./message-store.ts";

describe("FakeMessageStore", () => {
	messageStoreContract(() => new FakeMessageStore());
	historySearchContract(() => new FakeMessageStore());
});
