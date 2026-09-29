/**
 * Quando o bot responde (mesmas regras do bot Go):
 * - so canais da allowlist, na guild configurada (vazia = qualquer); DM nunca
 * - so quando mencionado ou em reply a uma mensagem dele
 * - nunca a bots, mensagens de sistema ou webhooks
 */

export interface Place {
	guildId: string | null;
	channelId: string;
}

export interface ChannelAccess {
	guildId: string;
	channelIds: readonly string[];
}

export interface MessageFacts {
	fromBot: boolean;
	fromSystem: boolean;
	viaWebhook: boolean;
	mentionsBot: boolean;
	repliesToBot: boolean;
}

export function isAllowedChannel(place: Place, access: ChannelAccess): boolean {
	if (place.guildId === null) return false;
	if (access.guildId !== "" && place.guildId !== access.guildId) return false;
	return access.channelIds.includes(place.channelId);
}

export function shouldReply(facts: MessageFacts): boolean {
	if (facts.fromBot || facts.fromSystem || facts.viaWebhook) return false;
	return facts.mentionsBot || facts.repliesToBot;
}
