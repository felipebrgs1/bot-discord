import { expect, it } from "bun:test";
import type { ImageData } from "@/domain/image.ts";
import type { ImageShrinker } from "./image-shrinker.ts";

/**
 * `compressible` tem que ser maior que `compressibleMax` e caber nele depois
 * de comprimida (ex.: foto em PNG). Um maxBytes de 1 nao cabe nada.
 */
export function imageShrinkerContract(make: () => ImageShrinker, compressible: ImageData, compressibleMax: number): void {
	it("devolve a mesma imagem quando ja cabe", async () => {
		expect(await make().shrink(compressible, 10 << 20)).toEqual(compressible);
	});

	it("reduz a imagem para caber no maximo pedido", async () => {
		const out = await make().shrink(compressible, compressibleMax);
		expect(out).not.toBeNull();
		expect(out?.mimeType.startsWith("image/")).toBe(true);
		expect(Buffer.byteLength(out?.data ?? "", "base64")).toBeLessThanOrEqual(compressibleMax);
	});

	it("devolve null quando nem comprimida cabe", async () => {
		expect(await make().shrink(compressible, 1)).toBeNull();
	});
}
