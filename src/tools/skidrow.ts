/**
 * lista: pesquisa o jogo no Skidrow Reloaded e devolve o top 3.
 *
 * Fluxo manual equivalente: entrar em
 * https://www.skidrowreloaded.com/home-/ , ir na pesquisa e digitar o
 * nome do jogo com espaços (ex.: "the sims", nunca "thesims").
 * Resposta: as 3 primeiras opções (nome + link da postagem).
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { textResult } from "./index.ts";
import { fetchJson, fetchText, guardSSRF } from "./net.ts";

const SEARCH_BASE = "https://www.skidrowreloaded.com/";

/** Normaliza espaços e monta a URL de busca (?s=...+x=15&y=25). */
export function buildSkidrowLink(jogo: string): string {
	const normalized = jogo.trim().replace(/\s+/g, " ");
	if (!normalized) throw new Error("nome do jogo vazio");
	// Espaço vira "+", resto vai URL-encoded (ex.: "the sims" -> "the+sims").
	const s = normalized
		.split(" ")
		.map((w) => encodeURIComponent(w))
		.join("+");
	return `${SEARCH_BASE}?s=${s}&x=15&y=25`;
}

/** Definição do slash command /lista (registrada na guild pelo gateway). */
export const LISTA_COMMAND_JSON = new SlashCommandBuilder()
	.setName("lista")
	.setDescription("Gera o link de pesquisa do jogo no Skidrow Reloaded")
	.addStringOption((o) =>
		o.setName("jogo").setDescription("Nome do jogo com espaços, ex.: the sims").setRequired(true),
	)
	.toJSON();

export interface SkidrowHit {
	title: string;
	url: string;
	cover?: string;
}

/** Extrai os resultados da página de busca (cada um é <h2><a href>). */
export function parseSkidrowTop(html: string, limit = 3): SkidrowHit[] {
	const covers = new Map<string, string>();
	for (const tag of html.match(/<img[^>]+>/gi) ?? []) {
		const src = /src="([^"]+)"/i.exec(tag)?.[1]?.trim();
		const alt = unescapeSkidrow(/alt="([^"]*)"/i.exec(tag)?.[1]?.trim() ?? "");
		if (src && alt && !covers.has(alt)) covers.set(alt, src);
	}
	const out: SkidrowHit[] = [];
	const re = /<h2[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
	for (;;) {
		if (out.length >= limit) break;
		const m = re.exec(html);
		if (!m) break;
		const url = (m[1] ?? "").trim();
		const title = unescapeSkidrow((m[2] ?? "").replace(/<[^>]+>/g, "").trim());
		if (url && title) out.push({ title, url, cover: covers.get(title) });
	}
	return out;
}

/** Embed do /lista: título = nome do jogo, itens = links, thumb = capa. */
export function listaEmbed(displayName: string, hits: SkidrowHit[], correctedFrom?: string): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(displayName)
		.setDescription(hits.map((h, n) => `**${n + 1}.** [${h.title}](${h.url})`).join("\n"))
		.setColor(0x2b2d31);
	const cover = hits[0]?.cover;
	if (cover) embed.setThumbnail(cover);
	if (correctedFrom) embed.setFooter({ text: `Nome corrigido: ${correctedFrom} → ${displayName}` });
	return embed;
}

function unescapeSkidrow(s: string): string {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

/** Busca o jogo e devolve os `limit` primeiros resultados. */
export async function fetchSkidrowTop(jogo: string, limit = 3): Promise<SkidrowHit[]> {
	const link = buildSkidrowLink(jogo); // valida o nome
	await guardSSRF(new URL(link).host);
	const { status, text } = await fetchText(link);
	if (status < 200 || status >= 300) throw new Error(`HTTP ${status} no Skidrow`);
	return parseSkidrowTop(text, limit);
}

/** Formata o top 3 p/ Discord; sem resultado, devolve o link da busca. */
export function formatSkidrowTop(jogo: string, hits: SkidrowHit[]): string {
	if (hits.length === 0) return `(nada encontrado; busca: ${buildSkidrowLink(jogo)})`;
	return hits.map((h, n) => `${n + 1}. ${h.title}\n${h.url}`).join("\n");
}

/**
 * Corrige o nome via catálogo Steam (sem chave, sem embeddings):
 * "thesims" não existe no Skidrow, "The Sims 4" sim.
 * Só é chamada quando a busca direta volta vazia.
 */
export async function correctGameName(jogo: string): Promise<string | null> {
	const u = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(jogo)}&l=english&cc=BR`;
	await guardSSRF(new URL(u).host);
	let data: { items?: { name?: string }[] };
	try {
		data = await fetchJson<{ items?: { name?: string }[] }>(u);
	} catch {
		return null;
	}
	const raw = data.items?.[0]?.name?.trim();
	if (!raw) return null;
	const clean = raw.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
	return clean || null;
}

/** Extrai o magnet da página da postagem (um por post). */
export function parseMagnet(html: string): string | null {
	const m = /magnet:\?[^"<>\s]+/.exec(html)?.[0];
	return m ? unescapeSkidrow(m) : null;
}

/** Baixa a postagem e devolve o link magnético. */
export async function fetchMagnet(postUrl: string): Promise<string> {
	let u: URL;
	try {
		u = new URL(postUrl);
	} catch {
		throw new Error("URL da postagem inválida");
	}
	if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.host) {
		throw new Error("URL da postagem inválida");
	}
	await guardSSRF(u.host);
	const { status, text } = await fetchText(u.toString());
	if (status < 200 || status >= 300) throw new Error(`HTTP ${status} no Skidrow`);
	const magnet = parseMagnet(text);
	if (!magnet) throw new Error("magnet não encontrado na página");
	return magnet;
}

export interface SkidrowSearch {
	text: string;
	hits: SkidrowHit[];
	displayName: string;
	correctedFrom?: string;
}

/** Pesquisa e devolve texto + hits (hits alimentam embed e botões 1/2/3). */
export async function searchSkidrow(jogo: string, limit = 3): Promise<SkidrowSearch> {
	const name = jogo.trim().replace(/\s+/g, " ");
	if (!name) throw new Error("informe o nome do jogo (ex.: the sims)");
	const hits = await fetchSkidrowTop(name, limit);
	if (hits.length > 0) return { text: formatSkidrowTop(name, hits), hits, displayName: name };
	const corrected = await correctGameName(name);
	if (corrected && corrected.toLowerCase() !== name.toLowerCase()) {
		const fixed = await fetchSkidrowTop(corrected, limit);
		if (fixed.length > 0) {
			return {
				text: `Nome corrigido: ${name} → ${corrected}\n${formatSkidrowTop(corrected, fixed)}`,
				hits: fixed,
				displayName: corrected,
				correctedFrom: name,
			};
		}
	}
	return { text: formatSkidrowTop(name, hits), hits, displayName: name };
}

/** Pesquisa e já devolve o texto pronto p/ responder (com correção de nome). */
export async function listaJogo(jogo: string, limit = 3): Promise<string> {
	return (await searchSkidrow(jogo, limit)).text;
}

export function magnetTool(): ToolDefinition {
	return defineTool({
		name: "magnet",
		label: "Magnet do Skidrow",
		description:
			"Traz o link magnético de uma das 3 opções listadas pela tool lista. Passe a URL da postagem (a que veio no top 3). Retorna o magnet:?xt=... pronto p/ o cliente torrent.",
		parameters: Type.Object({
			url: Type.String({ description: "URL da postagem do top 3" }),
		}),
		async execute(_id, params) {
			const url = (params.url ?? "").trim();
			if (!url) return textResult("erro: informe a URL da postagem (uma das 3 listadas)");
			try {
				return textResult(await fetchMagnet(url));
			} catch (err) {
				return textResult(`erro: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	});
}

export function listaTool(): ToolDefinition {
	return defineTool({
		name: "lista",
		label: "Pesquisa Skidrow",
		description:
			"Pesquisa o jogo no Skidrow Reloaded e retorna as 3 primeiras opções com nome e link. Passe o nome COM espaços (ex.: 'the sims'); se o usuário digitar grudado ('thesims'), separe em palavras antes de chamar — a tool também corrige sozinha via catálogo quando a busca volta vazia.",
		parameters: Type.Object({
			jogo: Type.String({ description: "Nome do jogo com espaços, ex.: the sims" }),
		}),
		async execute(_id, params) {
			const jogo = (params.jogo ?? "").trim();
			if (!jogo) return textResult("erro: informe o nome do jogo (ex.: the sims)");
			try {
				return textResult(await listaJogo(jogo));
			} catch (err) {
				return textResult(`erro: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	});
}
