export type View = "chat" | "memory" | "logs" | "metrics" | "config";

export const VIEWS: readonly View[] = ["chat", "memory", "logs", "metrics", "config"];

export const VIEW_LABEL: Record<View, string> = {
	chat: "Conversa",
	memory: "Memória",
	logs: "Logs",
	metrics: "Métricas",
	config: "Config",
};

/** Hash exato; qualquer outra coisa cai na conversa. */
export function viewFromHash(hash: string): View {
	const id = hash.replace(/^#\/?/, "");
	return VIEWS.find((v) => v === id) ?? "chat";
}

export const hashFor = (view: View) => `#/${view}`;
