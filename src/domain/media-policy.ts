/** De onde o bot baixa video (yt-dlp): lista fechada. */

const SUPPORTED = ["x.com", "twitter.com", "tiktok.com", "instagram.com", "twitch.tv", "kick.com"];
const EXPLICIT_NO = [
	"youtu.be",
	"youtube.com",
	"facebook.com",
	"fb.watch",
	"reddit.com",
	"redd.it",
	"vimeo.com",
	"dailymotion.com",
	"soundcloud.com",
	"threads.net",
	"snapchat.com",
	"pinterest.com",
	"streamable.com",
];

const bareHost = (host: string) => host.toLowerCase().split(":")[0] ?? "";
const matches = (host: string, domains: readonly string[]) =>
	domains.some((d) => host === d || host.endsWith(`.${d}`));

export function mediaHostAllowed(host: string): boolean {
	return matches(bareHost(host), SUPPORTED);
}

/** Motivo p/ plataformas conhecidas sem suporte; '' para as desconhecidas. */
export function mediaUnsupportedReason(host: string): string {
	const h = bareHost(host);
	if (!matches(h, EXPLICIT_NO)) return "";
	return `só tenho suporte pra X/Twitter, TikTok, Instagram, Twitch e Kick; ${h} não dá pra baixar daqui`;
}
