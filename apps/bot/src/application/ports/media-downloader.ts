export type MediaResult =
	| { kind: "failed"; output: string }
	/** files/dropped: descricoes prontas (nome + tamanho ou motivo). */
	| { kind: "done"; files: string[]; dropped: string[] };

/** Baixa video por URL para o outbox do canal (teto de anexo: 20 MB). */
export interface MediaDownloader {
	download(url: string, channelId: string): Promise<MediaResult>;
}
