import { describe } from "bun:test";
import { memoryStoreContract } from "../../application/ports/memory-store.contract.ts";
import { FakeMemoryStore } from "./memory-store.ts";

describe("FakeMemoryStore", () => {
	memoryStoreContract(() => new FakeMemoryStore());
});
