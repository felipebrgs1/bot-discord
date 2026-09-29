/** Arquivos que tools largam para o canal (ex.: video baixado); o chat envia e descarta. */
export interface Outbox {
	/** Pasta do canal (id sanitizado). */
	dirFor(channelId: string): string;
	/** Arquivos pendentes (sem ocultos), caminho completo. */
	pending(channelId: string): Promise<string[]>;
	discard(path: string): Promise<void>;
}
