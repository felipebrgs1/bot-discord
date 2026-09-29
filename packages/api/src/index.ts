/**
 * Contrato HTTP do painel: o que o bot (apps/bot, adapter http-panel) e o
 * Worker (apps/web/worker.ts) respondem e o que o front (apps/web) le.
 *
 * So tipos. Campos em snake_case porque sao o formato do fio. Se um lado
 * muda sem o outro, o `bun run check` quebra.
 */

export type Role = "admin" | "user";

/** Corpo de toda resposta de erro (4xx/5xx). */
export interface ApiError {
	error: string;
}

// --- auth (/auth/*): servida pelo bot ou pelo Worker da Cloudflare ---

export interface AuthState {
	authenticated: boolean;
}

export interface LoginRequest {
	password: string;
}

// --- meta ---

export interface Meta {
	chat: boolean;
	agent: boolean;
	model: string;
	role: Role;
}

// --- chat web (/api/chat/sessions) ---

export interface ChatSession {
	id: string;
	title: string;
	updated_at: string;
	messages: number;
}

export interface ChatSessionList {
	sessions: ChatSession[];
}

export interface ChatMessage {
	id: string;
	author_id: string;
	author_name: string;
	content: string;
	reply_to?: string;
	is_bot: boolean;
	created_at: string;
}

export interface ChatHistory {
	messages: ChatMessage[];
}

export interface ChatStep {
	tool: string;
	args: string;
	output: string;
	duration_ms: number;
}

export interface SendChatRequest {
	content: string;
}

/** Eventos SSE do POST de mensagem, na ordem: accepted, step*, done | error. */
export interface ChatEvents {
	accepted: { message: ChatMessage };
	step: ChatStep;
	done: { message: ChatMessage; steps: ChatStep[] };
	error: { message: string };
}

export type ChatEventName = keyof ChatEvents;

// --- logs (/api/logs) ---

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
	id: number;
	time: string;
	level: LogLevel;
	msg: string;
	attrs?: Record<string, unknown>;
}

export interface LogPage {
	entries: LogEntry[];
	/** Cursor para o proximo `?after=`. */
	next: number;
}

// --- memoria (/api/memories, /api/learnings) ---

export type MemoryScope = "group" | "user";
export type MemoryStatus = "active" | "suppressed";

export interface MemoryItem {
	id: number;
	channel_id: string;
	scope: MemoryScope;
	user_id?: string;
	key: string;
	kind: string;
	status: MemoryStatus;
	content: string;
	version: number;
	updated_at: string;
}

export interface MemoryList {
	items: MemoryItem[];
}

export interface MemoryVersion {
	version: number;
	kind: string;
	status: MemoryStatus;
	content: string;
	reason: string;
	created_at: string;
}

export interface MemoryVersionList {
	versions: MemoryVersion[];
}

export type MemoryAction = "forget" | "restore";

export interface MemoryActionRequest {
	reason?: string;
}

export interface MemoryCorrection {
	content: string;
	reason?: string;
}

export interface Changed {
	changed: boolean;
}

export interface LearningEvent {
	at: string;
	kind: "memory" | "skill";
	channel_id: string;
	subject: string;
	detail: string;
}

export interface LearningList {
	events: LearningEvent[];
}

// --- metricas (/api/metrics) ---

export interface MetricTotals {
	requests: number;
	failures: number;
	input_tokens: number;
	output_tokens: number;
	cached_tokens: number;
	cache_write_tokens: number;
	/** Turnos com algum token de cache (leitura ou escrita). */
	cache_samples: number;
	cost_usd: number;
}

export interface ModelMetrics extends MetricTotals {
	provider: string;
	model: string;
	operation: string;
	source: string;
	avg_latency_ms: number | null;
}

export interface RecentCall {
	id: number;
	started_at: string;
	duration_ms: number;
	operation: string;
	source: string;
	provider: string;
	model: string;
	success: boolean;
	input_tokens: number | null;
	output_tokens: number | null;
	total_tokens: number | null;
	cached_tokens: number | null;
	cache_write_tokens: number | null;
	cost_usd: number | null;
}

export interface MetricsSnapshot {
	summary: MetricTotals;
	models: ModelMetrics[];
	/** Ate 50, mais novas primeiro. */
	recent: RecentCall[];
	/** Intervalo sugerido de atualizacao. */
	refresh_ms: number;
}

// --- config (/api/config/discord, /api/models, /api/model) ---

export interface DiscordConfig {
	guild_id: string;
	channel_ids: string[];
	admin_ids: string[];
	web_user_id: string;
	personality: string;
}

export interface Saved {
	saved: boolean;
	restart_required: boolean;
}

export interface ModelCatalog {
	models: string[];
	model: string;
}

export interface SetModelRequest {
	model: string;
}

export interface ModelChanged {
	model: string;
	restart_required: boolean;
}

// --- participacao (/api/participation): fase futura, hoje sempre vazia ---

export interface ParticipationReview {
	channel_id: string;
	source_id: string;
	kind: "spontaneous" | "followup" | "continuation";
	mode: "shadow" | "active";
	decision: string;
	source_text: string;
	draft: string;
	review: "" | "useful" | "unhelpful";
	created_at: string;
}

export interface ParticipationList {
	items: ParticipationReview[];
}
