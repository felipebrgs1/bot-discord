import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { findViolations, importsOf, type SourceFile } from "./test-support/architecture.ts";

const file = (path: string, ...specifiers: string[]): SourceFile => ({
	path,
	source: specifiers.map((s) => `import { x } from "${s}";`).join("\n"),
});

const specifiersOf = (files: SourceFile[]) => findViolations(files).map((v) => `${v.file} -> ${v.specifier}`);

describe("importsOf", () => {
	it("le import, import type, export from e import de efeito", () => {
		const source = [
			'import { a } from "./a.ts";',
			'import type { B } from "../b.ts";',
			'export { c } from "./c.ts";',
			'export * from "./d.ts";',
			'import "./e.ts";',
			"import {",
			"\tf,",
			"\tg,",
			'} from "node:fs";',
		].join("\n");
		expect(importsOf(source)).toEqual(["./a.ts", "../b.ts", "./c.ts", "./d.ts", "./e.ts", "node:fs"]);
	});

	it("ignora texto que so parece import dentro de string e comentario de linha", () => {
		const source = ['// import { x } from "./nao.ts";', 'const s = "from \\"./tambem-nao.ts\\"";'].join("\n");
		expect(importsOf(source)).toEqual([]);
	});
});

describe("findViolations: domain", () => {
	it("aceita import dentro do proprio domain", () => {
		expect(specifiersOf([file("domain/reply.ts", "./roles.ts")])).toEqual([]);
	});

	it("barra import de application, adapters e main", () => {
		expect(
			specifiersOf([file("domain/reply.ts", "../application/handle.ts", "../adapters/out/sqlite/db.ts", "../main/start.ts")]),
		).toEqual([
			"domain/reply.ts -> ../application/handle.ts",
			"domain/reply.ts -> ../adapters/out/sqlite/db.ts",
			"domain/reply.ts -> ../main/start.ts",
		]);
	});

	it("barra node:* e pacotes npm", () => {
		expect(specifiersOf([file("domain/reply.ts", "node:fs", "discord.js", "@earendil-works/pi-ai")])).toEqual([
			"domain/reply.ts -> node:fs",
			"domain/reply.ts -> discord.js",
			"domain/reply.ts -> @earendil-works/pi-ai",
		]);
	});
});

describe("findViolations: application", () => {
	it("aceita domain e a propria application, inclusive ports", () => {
		expect(
			specifiersOf([file("application/handle.ts", "../domain/roles.ts", "./ports/chat-agent.ts", "./other.ts")]),
		).toEqual([]);
	});

	it("barra adapters, main, node:* e npm", () => {
		expect(
			specifiersOf([
				file("application/handle.ts", "../adapters/in/discord/gateway.ts", "../main/start.ts", "node:sqlite", "discord.js"),
			]),
		).toHaveLength(4);
	});
});

describe("findViolations: adapters", () => {
	it("aceita domain, application, o proprio adapter, node:* e npm", () => {
		expect(
			specifiersOf([
				file(
					"adapters/out/sqlite/memory-store.ts",
					"../../../domain/memory.ts",
					"../../../application/ports/memory-store.ts",
					"./db.ts",
					"node:sqlite",
					"@earendil-works/pi-ai",
				),
			]),
		).toEqual([]);
	});

	it("barra outro adapter, inclusive entre in e out", () => {
		expect(
			specifiersOf([
				file("adapters/out/sqlite/memory-store.ts", "../web/fetcher.ts"),
				file("adapters/in/discord/gateway.ts", "../../out/sqlite/db.ts"),
			]),
		).toEqual([
			"adapters/out/sqlite/memory-store.ts -> ../web/fetcher.ts",
			"adapters/in/discord/gateway.ts -> ../../out/sqlite/db.ts",
		]);
	});

	it("barra main", () => {
		expect(specifiersOf([file("adapters/in/discord/gateway.ts", "../../../main/start.ts")])).toHaveLength(1);
	});
});

describe("findViolations: test-support e main", () => {
	it("so teste importa test-support", () => {
		expect(
			specifiersOf([
				file("application/handle.test.ts", "../test-support/fakes/memory-store.ts"),
				file("application/handle.ts", "../test-support/fakes/memory-store.ts"),
			]),
		).toEqual(["application/handle.ts -> ../test-support/fakes/memory-store.ts"]);
	});

	it("test-support importa domain e application, nunca adapters", () => {
		expect(
			specifiersOf([
				file("test-support/fakes/memory-store.ts", "../../application/ports/memory-store.ts", "../../domain/memory.ts"),
				file("test-support/fakes/db.ts", "../../adapters/out/sqlite/db.ts"),
			]),
		).toEqual(["test-support/fakes/db.ts -> ../../adapters/out/sqlite/db.ts"]);
	});

	it("main importa qualquer camada", () => {
		expect(
			specifiersOf([file("main/start.ts", "../adapters/in/discord/gateway.ts", "../application/handle.ts", "node:path")]),
		).toEqual([]);
	});
});

describe("findViolations: codigo legado", () => {
	it("ignora arquivos fora das camadas", () => {
		expect(specifiersOf([file("gateway.ts", "discord.js", "./db.ts"), file("tools/web.ts", "../net.ts")])).toEqual([]);
	});
});

describe("repo", () => {
	it("src respeita a regra de dependencia", async () => {
		const root = import.meta.dir;
		const entries = await readdir(root, { recursive: true });
		const files: SourceFile[] = [];
		for (const entry of entries) {
			if (!entry.endsWith(".ts")) continue;
			files.push({ path: relative(root, join(root, entry)), source: await readFile(join(root, entry), "utf8") });
		}
		expect(findViolations(files)).toEqual([]);
	});
});
