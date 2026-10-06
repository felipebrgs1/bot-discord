/** Imagem ja baixada, pronta para o modelo (base64). */
export interface ImageData {
	data: string;
	mimeType: string;
}

/** Quantas imagens entram numa resposta. */
export const MAX_VISION_IMAGES = 3;
/** Teto por imagem. */
export const MAX_IMAGE_BYTES = 5 << 20;

/** Sub-agente do /gerar: transforma o pedido do usuario num prompt de imagem. */
export const IMAGE_PROMPT_INSTRUCTIONS = `Você escreve prompts para um modelo de geração de imagem. Recebe o pedido de alguém num grupo do Discord, com o que se sabe do grupo, de quem pediu e a conversa recente.

Regras:
- Resolva referências ao contexto ("o grupo", "eu", "aquele meme", nomes de pessoas) usando o que você sabe; o modelo de imagem não vê nada além do prompt.
- Descreva com detalhe: assunto, aparência das pessoas, cenário, estilo, cores, enquadramento e qualquer texto que deva aparecer (entre aspas).
- Se o pedido já for detalhado, preserve a intenção e só complete o que falta.
- Não invente aparência que contradiga o que se sabe; se não souber, escolha algo neutro.

Responda só com o prompt, em uma linha, sem aspas em volta e sem comentário.`;
