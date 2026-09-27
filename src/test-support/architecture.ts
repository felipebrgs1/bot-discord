/**
 * Regra de dependencia da arquitetura hexagonal (ver AGENTS.md):
 * main -> adapters -> application -> domain. Caminhos relativos a src/.
 */

export interface SourceFile {
	path: string;
	source: string;
}

export interface Violation {
	file: string;
	specifier: string;
	rule: string;
}

type Layer = "domain" | "application" | "adapters" | "main" | "test-support";

const LAYERS: readonly string[] = ["domain", "application", "adapters", "main", "test-support"];

const ALLOWED: Record<Layer, readonly Layer[]> = {
	domain: ["domain"],
	application: ["domain", "application"],
	adapters: ["domain", "application", "adapters"],
	main: ["domain", "application", "adapters", "main"],
	"test-support": ["domain", "application"],
};

/** Imports estaticos no inicio de linha: comentario e string nao contam. */
const IMPORT_RE = /^\s*(?:import|export)\b(?:[^;"']*?\bfrom)?\s*["']([^"']+)["']/gm;

export function importsOf(source: string): string[] {
	return [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? "");
}

function layerOf(path: string): Layer | undefined {
	const first = path.split("/")[0] ?? "";
	return LAYERS.includes(first) ? (first as Layer) : undefined;
}

/** adapters/<in|out>/<nome>: a unidade que nao pode importar outra. */
function adapterOf(path: string): string {
	return path.split("/").slice(0, 3).join("/");
}

function resolve(from: string, specifier: string): string {
	const parts = from.split("/").slice(0, -1);
	for (const segment of specifier.split("/")) {
		if (segment === "..") parts.pop();
		else if (segment !== ".") parts.push(segment);
	}
	return parts.join("/");
}

const isTestCode = (path: string) => path.endsWith(".test.ts") || path.endsWith(".contract.ts");

function checkExternal(layer: Layer, path: string, specifier: string): string | undefined {
	if (layer === "adapters" || layer === "main") return undefined;
	if (specifier === "bun:test" && (isTestCode(path) || layer === "test-support")) return undefined;
	if (layer === "test-support" && specifier.startsWith("node:")) return undefined;
	return `${layer} nao importa dependencia externa`;
}

function checkInternal(layer: Layer, path: string, target: string): string | undefined {
	const targetLayer = layerOf(target);
	if (targetLayer === undefined) return `${layer} nao importa codigo legado`;
	if (targetLayer === "test-support") {
		return isTestCode(path) || layer === "test-support" ? undefined : "so codigo de teste importa test-support";
	}
	if (!ALLOWED[layer].includes(targetLayer)) return `${layer} nao importa ${targetLayer}`;
	if (layer === "adapters" && targetLayer === "adapters" && adapterOf(path) !== adapterOf(target)) {
		return "adapter nao importa outro adapter";
	}
	return undefined;
}

export function findViolations(files: SourceFile[]): Violation[] {
	const violations: Violation[] = [];
	for (const { path, source } of files) {
		const layer = layerOf(path);
		if (layer === undefined) continue;
		for (const specifier of importsOf(source)) {
			const rule = specifier.startsWith(".")
				? checkInternal(layer, path, resolve(path, specifier))
				: checkExternal(layer, path, specifier);
			if (rule !== undefined) violations.push({ file: path, specifier, rule });
		}
	}
	return violations;
}
