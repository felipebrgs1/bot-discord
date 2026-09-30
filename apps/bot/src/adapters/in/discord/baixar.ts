/** Slash command /baixar: video de X/Twitter, TikTok, Instagram, Twitch ou Kick como anexo. */

import { SlashCommandBuilder } from "discord.js";

export const BAIXAR_COMMAND_JSON = new SlashCommandBuilder()
	.setName("baixar")
	.setDescription("Baixa o vídeo na maior resolução que cabe em 20 MB (mínimo 240p)")
	.addStringOption((o) =>
		o.setName("url").setDescription("Link do vídeo (X/Twitter, TikTok, Instagram, Twitch ou Kick)").setRequired(true),
	)
	.toJSON();
