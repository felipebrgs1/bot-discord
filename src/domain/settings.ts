export interface DiscordConfig {
	guild_id: string;
	channel_ids: string[];
	admin_ids: string[];
}

export interface ChatConfig {
	base_url: string;
	model: string;
	reply_max_tokens: number;
}

export interface BotConfig {
	reply_cooldown_ms: number;
	context_max_bytes: number;
	backfill_window_min: number;
	personality: string;
}

export interface MemoryConfig {
	interval_ms: number;
	batch_size: number;
	context_max_tokens: number;
	shared_channel_ids: string[];
}

export interface JudgeConfig {
	enabled: boolean;
	threshold: number;
	timeout_ms: number;
}

export interface DashboardConfig {
	web_user_id: string;
}

export interface BotSettings {
	discord: DiscordConfig;
	chat: ChatConfig;
	bot: BotConfig;
	memory: MemoryConfig;
	judge: JudgeConfig;
	dashboard: DashboardConfig;
}

export interface SettingEntry {
	key: string;
	value: unknown;
}

const DEFAULTS: BotSettings = {
	discord: { guild_id: "", channel_ids: [], admin_ids: [] },
	chat: {
		base_url: "https://openrouter.ai/api/v1",
		model: "",
		reply_max_tokens: 1024,
	},
	bot: {
		reply_cooldown_ms: 4000,
		context_max_bytes: 64000,
		backfill_window_min: 120,
		personality: "Você é um amigo do servidor: direto, bem-humorado, fala PT-BR.",
	},
	memory: {
		interval_ms: 90_000,
		batch_size: 50,
		context_max_tokens: 3000,
		shared_channel_ids: [],
	},
	judge: { enabled: false, threshold: 0.3, timeout_ms: 4000 },
	dashboard: { web_user_id: "" },
};

/** Padroes em codigo: um banco zerado ja funciona. Copia nova a cada chamada. */
export function defaultSettings(): BotSettings {
	return structuredClone(DEFAULTS);
}

function setPath(settings: BotSettings, key: string, value: unknown): void {
	const parts = key.split(".");
	let cur = settings as unknown as Record<string, unknown>;
	for (const p of parts.slice(0, -1)) {
		if (typeof cur[p] !== "object" || cur[p] === null) cur[p] = {};
		cur = cur[p] as Record<string, unknown>;
	}
	cur[parts[parts.length - 1] ?? ""] = value;
}

/**
 * Padroes + entradas gravadas. Chave de secao ("discord") sobrepoe os campos
 * dados; chave pontuada ("chat.model") troca um campo e sempre vence a secao.
 */
export function settingsFrom(entries: readonly SettingEntry[]): BotSettings {
	const merged = defaultSettings();
	const sections = merged as unknown as Record<string, unknown>;
	for (const { key, value } of entries) {
		if (key.includes(".")) continue;
		if (value !== null && typeof value === "object" && typeof sections[key] === "object") {
			Object.assign(sections[key] as object, value);
		}
	}
	for (const { key, value } of entries) {
		if (key.includes(".")) setPath(merged, key, value);
	}
	return merged;
}

export function getSetting(settings: BotSettings, key: string): unknown {
	let cur: unknown = settings;
	for (const p of key.split(".")) {
		if (typeof cur !== "object" || cur === null) return undefined;
		cur = (cur as Record<string, unknown>)[p];
	}
	return cur;
}
