/**
 * Tools do bot para o agente do pi. Cada uma so traduz parametros e chama um
 * caso de uso; erro vira texto (o modelo le e explica ao usuario).
 */

import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentMemory } from "@/application/agent-memory.ts";
import type { Decide } from "@/application/decide.ts";
import type { DownloadMedia } from "@/application/download-media.ts";
import type { GenerateImage } from "@/application/generate-image.ts";
import type { Recall } from "@/application/recall.ts";
import type { SearchGames } from "@/application/search-games.ts";
import type { WebResearch } from "@/application/web-research.ts";
import type { MemoryBlockRef, MemoryEdit } from "@/domain/memory.ts";

export interface ToolServices {
	research: WebResearch;
	media: DownloadMedia;
	recall: Recall;
	memory: AgentMemory;
	images: GenerateImage;
	games: SearchGames;
	decide: Decide;
}

function textResult(text: string): { content: [{ type: "text"; text: string }]; details: Record<string, never> } {
	return { content: [{ type: "text", text }], details: {} };
}

/** O Jev foi treinado em ingles e erra mais em portugues. */
const JEV_HINT =
	"Escreva question e context em inglês (o modelo de decisão erra mais em português). No context vai o que se sabe de quem pergunta e do grupo que pesa na decisão. O bloco com as probabilidades é anexado sozinho no fim da sua resposta: não repita, comente o resultado do seu jeito.";

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface MemoryParams {
	action?: string;
	target?: string;
	person_id?: string;
	old_text?: string;
	content?: string;
}

/** Parametros da tool memory -> bloco + edicao; string = erro para o modelo. */
function memoryRequest(channelId: string, p: MemoryParams): { ref: MemoryBlockRef; edit: MemoryEdit } | string {
	let ref: MemoryBlockRef;
	if (p.target === "group") ref = { scope: "group", ownerId: channelId };
	else if (p.target === "user") {
		const person = (p.person_id ?? "").trim();
		if (!person) return "target user precisa de person_id";
		ref = { scope: "user", ownerId: person };
	} else return "target deve ser group ou user";
	const content = p.content ?? "";
	const oldText = p.old_text ?? "";
	if (p.action === "add") return content.trim() ? { ref, edit: { action: "add", content } } : "add precisa de content";
	if (p.action === "replace") {
		return oldText.trim() && content.trim()
			? { ref, edit: { action: "replace", oldText, content } }
			: "replace precisa de old_text e content";
	}
	if (p.action === "remove") return oldText.trim() ? { ref, edit: { action: "remove", oldText } } : "remove precisa de old_text";
	return "action deve ser add, replace ou remove";
}

/** Tools de toda conversa (user e admin); admin ganha as nativas do pi por fora. */
export function botTools(services: ToolServices, channelId: string): ToolDefinition[] {
	const { research, media, recall, memory, images, games, decide } = services;
	return [
		defineTool({
			name: "web_search",
			label: "Pesquisa web",
			description:
				"Pesquisa na web (notícias recentes e conhecimento geral). Use para fatos atuais (jogos, placares, notícias). Retorna resposta direta quando houver, títulos, links, datas e trechos.",
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
			name: "generate_image",
			label: "Gerar imagem",
			description:
				"Gera uma imagem a partir de uma descrição e ENVIA como anexo ao canal automaticamente. Descreva com detalhe: assunto, estilo, cores, enquadramento e qualquer texto que deva aparecer. Demora até um minuto.",
			parameters: Type.Object({ prompt: Type.String({ description: "Descrição detalhada da imagem" }) }),
			execute: async (_id, p) => textResult(await images.run(p.prompt ?? "", channelId)),
		}),
		defineTool({
			name: "search_history",
			label: "Buscar histórico",
			description:
				'Procura no histórico de conversas do canal por texto, período e pessoas — tudo o que foi dito, incluindo o que não está na sua memória. Retorna trechos com autor e data mais o que estava em volta. Use para "lembra quando...", links, piadas ou fatos antigos.',
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
			name: "memory",
			label: "Memória",
			description:
				"Escreve na sua memória durável, que entra inteira em toda conversa: o bloco do grupo (target group) ou o de uma pessoa (target user + person_id, o id que vem em [mensagem de ...]). Salve correção feita a você, preferência que vale para sempre e fato durável; nada de papo do dia. add cria uma entrada; replace troca a entrada que contém old_text; remove apaga a que contém old_text. O bloco tem teto: se der memória cheia, junte entradas (replace) ou apague a de menor valor (remove) e tente de novo.",
			parameters: Type.Object({
				action: Type.String({ description: "add, replace ou remove" }),
				target: Type.String({ description: "group (memória do grupo) ou user (memória de uma pessoa)" }),
				person_id: Type.Optional(Type.String({ description: "Id do Discord da pessoa (só em target user)" })),
				old_text: Type.Optional(Type.String({ description: "Trecho único da entrada a trocar ou apagar (replace/remove)" })),
				content: Type.Optional(Type.String({ description: "Frase curta e autocontida (add/replace)" })),
			}),
			async execute(_id, p) {
				const request = memoryRequest(channelId, p);
				if (typeof request === "string") return textResult(`erro: ${request}`);
				try {
					return textResult(memory.forTool(request.ref, request.edit));
				} catch (err) {
					return textResult(`erro ao salvar: ${errorText(err)}`);
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
		defineTool({
			name: "choose",
			label: "Escolher",
			description: `Escolhe entre opções ("paprika ou inception?", "pizza, sushi ou hambúrguer?") com um modelo de decisão que devolve a opção vencedora e a probabilidade de cada uma. ${JEV_HINT}`,
			parameters: Type.Object({
				question: Type.String({ description: "A pergunta, em inglês" }),
				options: Type.Array(Type.String(), { description: "De 2 a 10 opções, como o usuário escreveu" }),
				context: Type.Optional(Type.String({ description: "Contexto relevante, em inglês" })),
			}),
			execute: async (_id, p) => textResult(await decide.choose(channelId, p.question ?? "", p.options ?? [], p.context)),
		}),
		defineTool({
			name: "yes_or_no",
			label: "Sim ou não",
			description: `Responde pergunta de sim ou não ("devo ir pra academia hoje?") com um modelo de decisão que devolve a probabilidade de sim, de 0 a 1. ${JEV_HINT}`,
			parameters: Type.Object({
				question: Type.String({ description: "A pergunta de sim ou não, em inglês" }),
				context: Type.Optional(Type.String({ description: "Contexto relevante, em inglês" })),
			}),
			execute: async (_id, p) => textResult(await decide.odds(channelId, p.question ?? "", p.context)),
		}),
	];
}
