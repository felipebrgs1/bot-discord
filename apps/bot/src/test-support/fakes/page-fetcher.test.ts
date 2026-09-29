import { describe } from "bun:test";
import { pageFetcherContract } from "../../application/ports/page-fetcher.contract.ts";
import { CONTRACT_ROUTES, FakePageFetcher } from "./page-fetcher.ts";

describe("FakePageFetcher", () => {
	pageFetcherContract(() => new FakePageFetcher(CONTRACT_ROUTES));
});
