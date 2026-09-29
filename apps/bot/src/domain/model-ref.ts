/** Modelo escolhido por texto `provider/id` (ex.: AGENT_MODEL no .env). */
export interface ModelRef {
	provider: string;
	id: string;
}

/** Divide na primeira barra: o id pode ter barra (openrouter/anthropic/...). */
export function parseModelRef(text: string): ModelRef | undefined {
	const trimmed = text.trim();
	const slash = trimmed.indexOf("/");
	const provider = trimmed.slice(0, slash);
	const id = trimmed.slice(slash + 1);
	return slash > 0 && id ? { provider, id } : undefined;
}

export const formatModelRef = (ref: ModelRef) => `${ref.provider}/${ref.id}`;
