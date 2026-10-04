/** Pesquisa na web; devolve texto pronto para o modelo ('' = nada). */
export interface WebSearch {
	search(query: string, max: number): Promise<string>;
}
