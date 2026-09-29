import { describe, expect, it } from "bun:test";
import { mediaHostAllowed, mediaUnsupportedReason } from "./media-policy.ts";

describe("mediaHostAllowed", () => {
	it("so X/Twitter, TikTok, Instagram, Twitch e Kick (com subdominio e porta)", () => {
		for (const h of ["x.com", "twitter.com", "www.tiktok.com", "instagram.com:443", "clips.twitch.tv", "kick.com"]) {
			expect(mediaHostAllowed(h)).toBe(true);
		}
		expect(mediaHostAllowed("youtube.com")).toBe(false);
		expect(mediaHostAllowed("notx.com")).toBe(false);
	});
});

describe("mediaUnsupportedReason", () => {
	it("explica as plataformas conhecidas sem suporte", () => {
		expect(mediaUnsupportedReason("www.youtube.com")).toContain("só tenho suporte pra X/Twitter, TikTok");
		expect(mediaUnsupportedReason("www.youtube.com")).toContain("www.youtube.com não dá pra baixar");
	});

	it("desconhecida fica sem motivo", () => {
		expect(mediaUnsupportedReason("exemplo.com")).toBe("");
	});
});
