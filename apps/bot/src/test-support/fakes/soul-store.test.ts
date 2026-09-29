import { describe } from "bun:test";
import { soulStoreContract } from "../../application/ports/soul-store.contract.ts";
import { FakeSoulStore } from "./soul-store.ts";

describe("FakeSoulStore", () => {
	soulStoreContract(() => new FakeSoulStore());
});
