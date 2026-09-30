import { describe, expect, it } from "bun:test";
import { FakeClock } from "../test-support/fakes/clock.ts";
import { FakeLogger } from "../test-support/fakes/logger.ts";
import { FakeOutbox } from "../test-support/fakes/outbox.ts";
import { GenerateImage } from "./generate-image.ts";
import type { ImageGenerator } from "./ports/image-generator.ts";

function setup(generator: ImageGenerator = { generate: async () => ({ data: "aW1n", mimeType: "image/png" }) }) {
	const outbox = new FakeOutbox();
	const logger = new FakeLogger();
	const prompts: string[] = [];
	const spy: ImageGenerator = {
		generate: async (prompt) => {
			prompts.push(prompt);
			return generator.generate(prompt);
		},
	};
	return { outbox, logger, prompts, images: new GenerateImage(spy, outbox, new FakeClock(1000), logger) };
}

describe("GenerateImage", () => {
	it("gera a imagem e larga no outbox do canal", async () => {
		const { images, outbox, prompts } = setup();
		const text = await images.run("  um gato de oculos  ", "c1");
		expect(prompts).toEqual(["um gato de oculos"]);
		expect(await outbox.pending("c1")).toEqual(["/outbox/c1/imagem-1000.png"]);
		expect(outbox.saved.get("/outbox/c1/imagem-1000.png")).toBe("aW1n");
		expect(text).toStartWith("ok:");
	});

	it("extensao segue o tipo da imagem", async () => {
		const { images, outbox } = setup({ generate: async () => ({ data: "eA==", mimeType: "image/jpeg" }) });
		await images.run("gato", "c1");
		expect(await outbox.pending("c1")).toEqual(["/outbox/c1/imagem-1000.jpg"]);
	});

	it("prompt vazio nem chama o gerador", async () => {
		const { images, prompts } = setup();
		expect(await images.run("   ", "c1")).toBe("erro: descreva a imagem");
		expect(prompts).toEqual([]);
	});

	it("prompt longo demais e cortado", async () => {
		const { images, prompts } = setup();
		await images.run("a".repeat(5000), "c1");
		expect(prompts[0]).toHaveLength(4000);
	});

	it("falha do gerador vira texto de erro e log, sem arquivo", async () => {
		const { images, outbox, logger } = setup({
			generate: async () => {
				throw new Error("sem credencial do codex");
			},
		});
		expect(await images.run("gato", "c1")).toBe("erro ao gerar imagem: sem credencial do codex");
		expect(await outbox.pending("c1")).toEqual([]);
		expect(logger.lines.some((l) => l.startsWith("error image_generation_failed"))).toBe(true);
	});
});
