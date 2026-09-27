import { describe } from "bun:test";
import { outboxContract } from "../../application/ports/outbox.contract.ts";
import { fakeOutboxHarness } from "./outbox.ts";

describe("FakeOutbox", () => {
	outboxContract(fakeOutboxHarness);
});
