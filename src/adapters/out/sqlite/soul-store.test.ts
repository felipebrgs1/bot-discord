import { describe } from "bun:test";
import { soulStoreContract } from "../../../application/ports/soul-store.contract.ts";
import { openDatabase } from "./db.ts";
import { SqliteSoulStore } from "./soul-store.ts";

describe("SqliteSoulStore", () => {
	soulStoreContract(() => new SqliteSoulStore(openDatabase(":memory:")));
});
