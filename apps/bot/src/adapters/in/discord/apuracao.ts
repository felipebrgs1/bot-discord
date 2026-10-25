/** Slash command /apuracao: liga/desliga a apuracao de presidente no canal (so admin). */

import { SlashCommandBuilder } from "discord.js";

export const APURACAO_COMMAND_JSON = new SlashCommandBuilder()
	.setName("apuracao")
	.setDescription("Liga/desliga a apuração de presidente neste canal; sem opção mostra o estado")
	.addBooleanOption((o) => o.setName("ligado").setDescription("Liga (true) ou desliga (false): resumo a cada 30 min, thread por estado a cada 1h"))
	.toJSON();
