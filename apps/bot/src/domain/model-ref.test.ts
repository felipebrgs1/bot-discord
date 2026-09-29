import { describe, expect, it } from "bun:test";
import { parseModelRef } from "./model-ref.ts";

describe("parseModelRef", () => {
	it("separa provider e id na primeira barra", () => {
		expect(parseModelRef("openai-codex/gpt-6-luna")).toEqual({ provider: "openai-codex", id: "gpt-6-luna" });
	});

	it("id pode ter barra (openrouter)", () => {
		expect(parseModelRef(" openrouter/anthropic/claude-sonnet-5 ")).toEqual({ provider: "openrouter", id: "anthropic/claude-sonnet-5" });
	});

	it("rejeita sem provider ou sem id", () => {
		expect(parseModelRef("gpt-6-luna")).toBeUndefined();
		expect(parseModelRef("/gpt")).toBeUndefined();
		expect(parseModelRef("openai/")).toBeUndefined();
		expect(parseModelRef("")).toBeUndefined();
	});
});
