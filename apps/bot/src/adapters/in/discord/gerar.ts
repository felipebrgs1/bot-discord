/** Slash command /gerar: imagem pelo OpenRouter como anexo (o pedido em conversa segue no GPT Image). */

import { SlashCommandBuilder } from "discord.js";

export const GERAR_COMMAND_JSON = new SlashCommandBuilder()
	.setName("gerar")
	.setDescription("Gera uma imagem a partir de uma descrição")
	.addStringOption((o) =>
		// Teto abaixo dos 2000 do Discord: o prompt volta como texto da resposta.
		o.setName("prompt").setDescription("Descrição da imagem: assunto, estilo, cores, texto").setRequired(true).setMaxLength(1500),
	)
	.toJSON();
