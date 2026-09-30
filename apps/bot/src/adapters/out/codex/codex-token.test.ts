import { describe, expect, it } from "bun:test";
import { type AuthSource, codexToken } from "./codex-token.ts";

function source(keys: (string | undefined)[]) {
	const asked: string[] = [];
	const auth: AuthSource = {
		getAuth: async (provider) => {
			asked.push(provider);
			const key = keys.shift();
			return key === undefined ? undefined : { auth: { apiKey: key } };
		},
	};
	return { auth, asked };
}

describe("codexToken", () => {
	it("pede ao pi a credencial do openai-codex a cada chamada (o pi renova)", async () => {
		const { auth, asked } = source(["t1", "t2"]);
		let loads = 0;
		const token = codexToken(async () => {
			loads++;
			return auth;
		});
		expect(await token()).toBe("t1");
		expect(await token()).toBe("t2");
		expect(asked).toEqual(["openai-codex", "openai-codex"]);
		expect(loads).toBe(1);
	});

	it("sem login no pi explica como resolver", async () => {
		const { auth } = source([undefined]);
		await expect(codexToken(async () => auth)()).rejects.toThrow("sem login do Codex no pi");
	});

	it("falha ao carregar o pi nao fica em cache", async () => {
		const { auth } = source(["t1"]);
		let first = true;
		const token = codexToken(async () => {
			if (first) {
				first = false;
				throw new Error("auth.json travado");
			}
			return auth;
		});
		await expect(token()).rejects.toThrow("auth.json travado");
		expect(await token()).toBe("t1");
	});
});
