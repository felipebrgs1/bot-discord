import { describe } from "bun:test";
import { imageShrinkerContract } from "@/application/ports/image-shrinker.contract.ts";
import { FakeImageShrinker } from "./image-shrinker.ts";

describe("FakeImageShrinker", () => {
	imageShrinkerContract(
		() => new FakeImageShrinker(),
		{ data: Buffer.alloc(2000, 7).toString("base64"), mimeType: "image/png" },
		1000,
	);
});
