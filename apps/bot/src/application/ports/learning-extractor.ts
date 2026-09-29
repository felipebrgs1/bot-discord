/** Modelo que responde JSON a um prompt de extracao de aprendizado. */
export interface LearningExtractor {
	complete(prompt: string): Promise<unknown>;
}
