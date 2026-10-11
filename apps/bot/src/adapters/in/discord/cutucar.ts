/** Slash command /cutucar: liga/desliga o cutucao de canal parado e troca o tempo (so admin). */

import { SlashCommandBuilder } from "discord.js";
import { IDLE_MIN_RANGE } from "../../../domain/idle-nudge.ts";

export const CUTUCAR_COMMAND_JSON = new SlashCommandBuilder()
	.setName("cutucar")
	.setDescription("Liga/desliga o puxa-assunto em canal parado e troca o tempo; sem opções mostra o estado")
	.addBooleanOption((o) => o.setName("ligado").setDescription("Liga (true) ou desliga (false) o cutucão"))
	.addIntegerOption((o) =>
		o
			.setName("minutos")
			.setDescription("Minutos de canal parado antes de puxar assunto")
			.setMinValue(IDLE_MIN_RANGE.min)
			.setMaxValue(IDLE_MIN_RANGE.max),
	)
	.toJSON();
