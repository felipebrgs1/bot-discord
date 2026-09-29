/** Apresentacao do /lista no Discord: slash command, embed e botoes 1/2/3. */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { GameHit } from "../../../domain/game.ts";

export const LISTA_COMMAND_JSON = new SlashCommandBuilder()
	.setName("lista")
	.setDescription("Gera o link de pesquisa do jogo no Skidrow Reloaded")
	.addStringOption((o) => o.setName("jogo").setDescription("Nome do jogo com espaços, ex.: the sims").setRequired(true))
	.toJSON();

/** Prefixo do customId dos botoes (skr:0, skr:1, skr:2). */
export const MAGNET_BUTTON_PREFIX = "skr:";

function hslToInt(h: number, s: number, l: number): number {
	const sat = s / 100;
	const lig = l / 100;
	const k = (n: number): number => (n + h / 30) % 12;
	const a = sat * Math.min(lig, 1 - lig);
	const f = (n: number): number => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

/** Cor lateral vibrante e deterministica por jogo (nunca o cinza padrao). */
export function colorForGame(name: string): number {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
	return hslToInt(h, 70, 50);
}

const trunc = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Titulo curto com emoji, capa grande, 3 fields (nome + link), footer + timestamp. */
export function listaEmbed(displayName: string, hits: readonly GameHit[], correctedFrom?: string): EmbedBuilder {
	const short = trunc(displayName, 200);
	const embed = new EmbedBuilder().setTitle(`🎮 ${short}`).setColor(colorForGame(short));
	const cover = hits[0]?.cover;
	if (cover) embed.setImage(cover);
	for (const [i, h] of hits.slice(0, 3).entries()) {
		embed.addFields({ name: `${i + 1}. ${trunc(h.title, 200)}`, value: `[🔗 Ver página](${h.url})` });
	}
	const corrected = correctedFrom ? `Corrigido: ${correctedFrom} → ${short} · ` : "";
	return embed.setFooter({ text: `${corrected}Top 3 · Skidrow Reloaded` }).setTimestamp();
}

/** Linha de botoes 1..n (ate 3) p/ pedir o magnet; vazia sem hits. */
export function magnetRow(n: number): ActionRowBuilder<ButtonBuilder>[] {
	if (n <= 0) return [];
	const row = new ActionRowBuilder<ButtonBuilder>();
	for (let i = 0; i < Math.min(n, 3); i++) {
		row.addComponents(
			new ButtonBuilder().setCustomId(`${MAGNET_BUTTON_PREFIX}${i}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Primary),
		);
	}
	return [row];
}
