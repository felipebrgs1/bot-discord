/**
 * Tools do bot para o agente do pi. Cada uma so traduz parametros e chama um
 * caso de uso; erro vira texto (o modelo le e explica ao usuario).
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { DownloadMedia } from "../../../application/download-media.ts";
import type { Recall } from "../../../application/recall.ts";
import type { SearchGames } from "../../../application/search-games.ts";
import type { WebResearch } from "../../../application/web-research.ts";

export interface ToolServices {
	research: WebResearch;
	media: DownloadMedia;
	recall: Recall;
	games: SearchGames;
}

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
	return { content: [{ type: "text", text }], details: {} };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Tools de toda conversa (user e admin); admin ganha as nativas do pi por fora. */
export function botTools(services: ToolServices, channelId: string): ToolDefinition[] {
	const { research, media, recall, games } = services;
	return [
		defineTool({
			name: "web_search",
			label: "Pesquisa web",
			description:
				"Pesquisa notícias recentes e conhecimento geral na web, sem chave. Use para fatos atuais (jogos, placares, notícias). Retorna títulos, fontes, datas e links.",
			parameters: Type.Object({
				query: Type.String({ description: "O que pesquisar" }),
				max_results: Type.Optional(Type.Number({ description: "Máximo de resultados (1-10, padrão 5)" })),
			}),
			execute: async (_id, p) => textResult(await research.search(p.query ?? "", p.max_results)),
		}),
		defineTool({
			name: "web_fetch",
			label: "Ler página",
			description: "Baixa uma página pública e devolve o texto legível. Use para ler a matéria completa após web_search.",
			parameters: Type.Object({
				url: Type.String({ description: "URL http/https pública" }),
				max_bytes: Type.Optional(Type.Number({ description: "Teto do texto (padrão 8000, máx 20000)" })),
			}),
			execute: async (_id, p) => textResult(await research.read(p.url ?? "", p.max_bytes)),
		}),
		defineTool({
			name: "download_media",
			label: "Baixar mídia",
			description:
				"Baixa vídeo de X/Twitter, TikTok, Instagram, Twitch ou Kick por URL e ENVIA como anexo ao canal automaticamente. OUTRAS PLATAFORMAS (YouTube, Facebook, Vimeo...) não têm suporte — avise antes de tentar.",
			parameters: Type.Object({ url: Type.String({ description: "URL do vídeo" }) }),
			execute: async (_id, p) => textResult(await media.run(p.url ?? "", channelId)),
		}),
		defineTool({
			name: "search_history",
			label: "Buscar histórico",
			description:
				'Procura no histórico de conversas do canal por texto, período e pessoas — a memória do que foi dito, incluindo o que não virou memória durável. Retorna trechos com autor e data mais o que estava em volta. Use para "lembra quando...", links, piadas ou fatos antigos.',
			parameters: Type.Object({
				query: Type.Optional(Type.String({ description: "Texto (FTS em português)" })),
				days: Type.Optional(Type.Number({ description: "Só dos últimos N dias" })),
				author_id: Type.Optional(Type.String({ description: "Só mensagens deste autor (id do Discord)" })),
				limit: Type.Optional(Type.Number({ description: "Máximo de trechos (padrão 5, máx 10)" })),
			}),
			async execute(_id, p) {
				try {
					return textResult(
						recall.searchHistory({ channelId, query: p.query, days: p.days, authorId: p.author_id, limit: p.limit }),
					);
				} catch (err) {
					return textResult(`erro na busca: ${errorText(err)}`);
				}
			},
		}),
		defineTool({
			name: "memory_search",
			label: "Buscar memórias",
			description:
				"Busca nas memórias duráveis do grupo e suas (fatos, preferências, lições, piadas internas). Use quando a resposta precisar de algo aprendido antes que não está na conversa atual.",
			parameters: Type.Object({
				query: Type.String({ description: "O que procurar" }),
				limit: Type.Optional(Type.Number({ description: "Máximo (padrão 5, máx 8)" })),
			}),
			async execute(_id, p) {
				try {
					return textResult(recall.searchMemories(channelId, p.query ?? "", p.limit));
				} catch (err) {
					return textResult(`erro na busca: ${errorText(err)}`);
				}
			},
		}),
		defineTool({
			name: "lista",
			label: "Pesquisa Skidrow",
			description:
				"Pesquisa o jogo no Skidrow Reloaded e retorna as 3 primeiras opções com nome e link. Passe o nome COM espaços (ex.: 'the sims'); se o usuário digitar grudado ('thesims'), separe em palavras antes de chamar — a tool também corrige sozinha via catálogo quando a busca volta vazia.",
			parameters: Type.Object({ jogo: Type.String({ description: "Nome do jogo com espaços, ex.: the sims" }) }),
			async execute(_id, p) {
				const jogo = (p.jogo ?? "").trim();
				if (!jogo) return textResult("erro: informe o nome do jogo (ex.: the sims)");
				try {
					return textResult((await games.search(jogo)).text);
				} catch (err) {
					return textResult(`erro: ${errorText(err)}`);
				}
			},
		}),
		defineTool({
			name: "magnet",
			label: "Magnet do Skidrow",
			description:
				"Traz o link magnético de uma das 3 opções listadas pela tool lista. Passe a URL da postagem (a que veio no top 3). Retorna o magnet:?xt=... pronto p/ o cliente torrent.",
			parameters: Type.Object({ url: Type.String({ description: "URL da postagem do top 3" }) }),
			async execute(_id, p) {
				const url = (p.url ?? "").trim();
				if (!url) return textResult("erro: informe a URL da postagem (uma das 3 listadas)");
				try {
					return textResult(await games.magnet(url));
				} catch (err) {
					return textResult(`erro: ${errorText(err)}`);
				}
			},
		}),
	];
}
