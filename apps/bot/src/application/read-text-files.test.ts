import { describe, expect, it } from "bun:test";
import { FakePageFetcher } from "@/test-support/fakes/page-fetcher.ts";
import { ReadTextFiles } from "./read-text-files.ts";

describe("ReadTextFiles", () => {
	it("baixa os anexos e devolve o texto com o nome de cada arquivo", async () => {
		const texts = new ReadTextFiles(new FakePageFetcher([[/message/, { body: "qual alternativa?" }], [/notas/, { body: "# notas" }]]));
		expect(
			await texts.run([
				{ name: "message.txt", url: "https://cdn/message.txt" },
				{ name: "notas.md", url: "https://cdn/notas.md" },
			]),
		).toBe("[arquivo message.txt]\nqual alternativa?\n\n[arquivo notas.md]\n# notas");
	});

	it("falha de rede, HTTP de erro e arquivo vazio sao descartados", async () => {
		const texts = new ReadTextFiles(new FakePageFetcher([[/404/, { status: 404, body: "nao achei" }], [/vazio/, { body: "  " }], [/ok/, { body: "oi" }]]));
		expect(
			await texts.run([
				{ name: "a.txt", url: "https://cdn/404.txt" },
				{ name: "b.txt", url: "https://cdn/vazio.txt" },
				{ name: "c.txt", url: "https://cdn/ok.txt" },
			]),
		).toBe("[arquivo c.txt]\noi");
		expect(await texts.run([{ name: "d.txt", url: "https://cdn/sem-rota.txt" }])).toBe("");
	});

	it("le no maximo 3 arquivos", async () => {
		const fetcher = new FakePageFetcher([[/cdn/, { body: "x" }]]);
		await new ReadTextFiles(fetcher).run(["1", "2", "3", "4"].map((n) => ({ name: `${n}.txt`, url: `https://cdn/${n}.txt` })));
		expect(fetcher.requested).toHaveLength(3);
	});
});
