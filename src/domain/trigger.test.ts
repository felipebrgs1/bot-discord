import { describe, expect, it } from "bun:test";
import { isAllowedChannel, type MessageFacts, shouldReply } from "./trigger.ts";

const access = { guildId: "g1", channelIds: ["c1"] };

describe("isAllowedChannel", () => {
	it("aceita canal da allowlist na guild configurada", () => {
		expect(isAllowedChannel({ guildId: "g1", channelId: "c1" }, access)).toBe(true);
	});

	it("recusa canal fora da allowlist", () => {
		expect(isAllowedChannel({ guildId: "g1", channelId: "c9" }, access)).toBe(false);
	});

	it("recusa outra guild", () => {
		expect(isAllowedChannel({ guildId: "outra", channelId: "c1" }, access)).toBe(false);
	});

	it("recusa DM (sem guild), mesmo com guild livre", () => {
		expect(isAllowedChannel({ guildId: null, channelId: "c1" }, access)).toBe(false);
		expect(isAllowedChannel({ guildId: null, channelId: "c1" }, { guildId: "", channelIds: ["c1"] })).toBe(false);
	});

	it("guild vazia na config aceita qualquer guild, ainda exigindo a allowlist", () => {
		const open = { guildId: "", channelIds: ["c1"] };
		expect(isAllowedChannel({ guildId: "qualquer", channelId: "c1" }, open)).toBe(true);
		expect(isAllowedChannel({ guildId: "qualquer", channelId: "c9" }, open)).toBe(false);
	});
});

const human: MessageFacts = {
	fromBot: false,
	fromSystem: false,
	viaWebhook: false,
	mentionsBot: false,
	repliesToBot: false,
};

describe("shouldReply", () => {
	it("responde quando mencionado", () => {
		expect(shouldReply({ ...human, mentionsBot: true })).toBe(true);
	});

	it("responde a reply numa mensagem do bot", () => {
		expect(shouldReply({ ...human, repliesToBot: true })).toBe(true);
	});

	it("ignora conversa sem mencao nem reply", () => {
		expect(shouldReply(human)).toBe(false);
	});

	it("ignora bot, sistema e webhook mesmo mencionando", () => {
		expect(shouldReply({ ...human, mentionsBot: true, fromBot: true })).toBe(false);
		expect(shouldReply({ ...human, mentionsBot: true, fromSystem: true })).toBe(false);
		expect(shouldReply({ ...human, mentionsBot: true, viaWebhook: true })).toBe(false);
	});
});
