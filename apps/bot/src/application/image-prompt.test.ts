import { describe, expect, it } from "bun:test";
import { IMAGE_PROMPT_INSTRUCTIONS } from "@/domain/image.ts";
import { FakeLogger } from "@/test-support/fakes/logger.ts";
import { FakeSubAgents } from "@/test-support/fakes/sub-agents.ts";
import { ImagePromptWriter } from "./image-prompt.ts";
import type { Turn } from "./persona.ts";

const turn: Turn = { channelId: "c1", authorId: "u1", authorName: "ana", messageId: "m1", text: "uma imagem do grupo" };

function setup() {
	const agents = new FakeSubAgents();
	const logger = new FakeLogger();
	const writer = new ImagePromptWriter({
		agents,
		logger,
		systemPromptFor: (channelId) => `grupo do ${channelId}: ana, beto`,
		turnText: (t) => `[contexto]\n${t.text}`,
	});
	return { agents, logger, writer };
}

describe("ImagePromptWriter", () => {
	it("pede ao sub-agente, sem tools, o prompt com o contexto do canal", async () => {
		const { agents, writer } = setup();
		agents.answer = async () => "  ilustracao de ana e beto num bar  ";
		expect(await writer.write(turn)).toBe("ilustracao de ana e beto num bar");
		expect(agents.tasks).toEqual([
			{
				instructions: `${IMAGE_PROMPT_INSTRUCTIONS}\n\ngrupo do c1: ana, beto`,
				text: "[contexto]\numa imagem do grupo",
				tools: false,
				conversationId: "c1",
			},
		]);
	});

	it("falha do sub-agente cai no pedido original e loga", async () => {
		const { agents, logger, writer } = setup();
		agents.answer = async () => {
			throw new Error("rate limit");
		};
		expect(await writer.write(turn)).toBe("uma imagem do grupo");
		expect(logger.lines.some((l) => l.startsWith("error image_prompt_failed"))).toBe(true);
	});

	it("resposta vazia cai no pedido original", async () => {
		const { agents, writer } = setup();
		agents.answer = async () => "   ";
		expect(await writer.write(turn)).toBe("uma imagem do grupo");
	});
});
