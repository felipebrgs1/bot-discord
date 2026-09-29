import { describe } from "bun:test";
import { configStoreContract } from "../../application/ports/config-store.contract.ts";
import { FakeConfigStore } from "./config-store.ts";

describe("FakeConfigStore", () => {
	configStoreContract(() => new FakeConfigStore());
});
