/**
 * One pi AgentSession per Discord channel (Fase 1).
 *
 * The factory is injectable so the gateway stays unit-testable and the
 * composition root owns auth/model selection. Sessions are created lazily
 * and disposed when idle past `idleMs` (swept on every access).
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { TurnReport } from "./domain/turn.ts";

interface StatsTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

/** Totais acumulados da sessao (getSessionStats do SDK); null se indisponivel. */
function statsOf(session: unknown): StatsTotals | null {
	try {
		const s = session as { getSessionStats?: () => unknown };
		if (typeof s.getSessionStats !== "function") return null;
		const stats = s.getSessionStats() as {
			tokens?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
			cost?: unknown;
		};
		const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		return {
			input: num(stats.tokens?.input),
			output: num(stats.tokens?.output),
			cacheRead: num(stats.tokens?.cacheRead),
			cacheWrite: num(stats.tokens?.cacheWrite),
			cost: num(stats.cost),
		};
	} catch {
		return null;
	}
}
import { canUseHostTools, type Role } from "./domain/roles.ts";
import { type ToolCtx, toolsFor } from "./tools/index.ts";

/** Tools nativas do pi que mexem na maquina do bot. Custom tools do bot sao user-safe. */
const PI_HOST_TOOLS = ["bash", "powershell", "edit", "write", "read", "grep", "find", "ls"];

/**
 * Deny-list p/ createAgentSession. A negacao vale na criacao da sessao: se o
 * papel muda, a sessao e recriada (chave canal+papel). Nao ha segundo nivel
 * de enforcement na execucao; sessao de user simplesmente nao recebe a tool.
 */
export function excludedToolsFor(role: Role): string[] {
	return canUseHostTools(role) ? [] : [...PI_HOST_TOOLS];
}

export interface SessionFactory {
	create(channelId: string, role: Role, systemExtra?: string): Promise<AgentSession>;
	dispose(session: AgentSession): void;
}

/** Production factory backed by the pi SDK (needs `pi auth` or a ModelRuntime). */
export function piSessionFactory(cwd: string, base?: Omit<ToolCtx, "channelId">): SessionFactory {
	return {
		async create(channelId: string, role: Role, systemExtra?: string): Promise<AgentSession> {
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir: getAgentDir(),
				appendSystemPrompt: systemExtra ? [systemExtra] : [],
			});
			await loader.reload();
			const { session } = await createAgentSession({
				cwd,
				resourceLoader: loader,
				sessionManager: SessionManager.inMemory(),
				excludeTools: excludedToolsFor(role),
				customTools: base ? toolsFor(role, { ...base, channelId }) : [],
			});
			return session;
		},
		dispose(session: AgentSession): void {
			try {
				session.dispose();
			} catch {
				/* already gone */
			}
		},
	};
}

interface Entry {
	session: AgentSession;
	role: Role;
	lastUsed: number;
}

export interface AskOpts {
	source?: string;
	model?: string;
	provider?: string;
	systemExtra?: string;
	images?: ImageContent[];
	onTurn?: (report: TurnReport) => void;
}

export class ChannelSessions {
	private readonly entries = new Map<string, Entry>();
	private readonly extra = new Map<string, string>();
	private readonly idleMs: number;

	private readonly factory: SessionFactory;

	constructor(factory: SessionFactory, idleMs = 30 * 60 * 1000) {
		this.factory = factory;
		this.idleMs = idleMs;
	}

	private pendingExtra(channelId: string): string | undefined {
		const v = this.extra.get(channelId);
		this.extra.delete(channelId);
		return v;
	}

	private key(channelId: string, role: Role): string {
		return `${channelId}::${role}`;
	}

	/**
	 * Get (creating if needed) the session for a channel+role.
	 * Keyed by BOTH: a user never reuses a session created with admin
	 * tools, and alternating roles don't thrash each other's context.
	 */
	async get(channelId: string, role: Role): Promise<AgentSession> {
		this.sweep();
		const existing = this.entries.get(this.key(channelId, role));
		if (existing) {
			// Keyed by channel+role (see key()): entry here always matches.
			existing.lastUsed = Date.now();
			return existing.session;
		}
		const session = await this.factory.create(channelId, role, this.pendingExtra(channelId));
		this.entries.set(this.key(channelId, role), { session, role, lastUsed: Date.now() });
		return session;
	}

	/** Ask the channel's session and return the final assistant text. */
	async ask(channelId: string, role: Role, message: string, opts?: AskOpts): Promise<string> {
		if (opts?.systemExtra !== undefined) this.extra.set(channelId, opts.systemExtra);
		const session = await this.get(channelId, role);
		const before = statsOf(session);
		const started = Date.now();
		try {
			await session.prompt(message, opts?.images?.length ? { images: opts.images } : undefined);
			if (typeof session.waitForIdle === "function") await session.waitForIdle();
			const text = typeof session.getLastAssistantText === "function" ? (session.getLastAssistantText() ?? "") : "";
			opts?.onTurn?.(this.turnReport(session, before, statsOf(session), started, "success", opts));
			return text;
		} catch (err) {
			opts?.onTurn?.(this.turnReport(session, before, statsOf(session), started, "error", opts));
			throw err;
		}
	}

	private turnReport(
		session: AgentSession,
		before: StatsTotals | null,
		after: StatsTotals | null,
		started: number,
		status: "success" | "error",
		opts?: AskOpts,
	): TurnReport {
		let actualId = "";
		let actualProvider = "";
		try {
			const m = (session as unknown as { model?: { id?: unknown; provider?: unknown } }).model;
			if (m && typeof m === "object") {
				if (typeof m.id === "string") actualId = m.id;
				if (typeof m.provider === "string") actualProvider = m.provider;
			}
		} catch {
			/* mantém fallback do config */
		}
		return {
			operation: "chat",
			model: actualId || opts?.model || "",
			provider: actualProvider || opts?.provider || "",
			source: opts?.source ?? "discord",
			status,
			latencyMs: Date.now() - started,
			inputTokens: before && after ? Math.max(0, after.input - before.input) : null,
			outputTokens: before && after ? Math.max(0, after.output - before.output) : null,
			cachedTokens: before && after ? Math.max(0, after.cacheRead - before.cacheRead) : null,
			cacheWriteTokens: before && after ? Math.max(0, after.cacheWrite - before.cacheWrite) : null,
			cost: before && after ? Math.max(0, after.cost - before.cost) : null,
		};
	}

	/** Channel ids with a live session (for the web session list). */
	keys(): string[] {
		this.sweep();
		const out = new Set<string>();
		for (const k of this.entries.keys()) out.add(k.split("::")[0] as string);
		return [...out];
	}

	/** Drop all sessions of a channel (web session delete). */
	remove(channelId: string): boolean {
		let dropped = false;
		for (const k of [...this.entries.keys()]) {
			if (k === channelId || k.startsWith(`${channelId}::`)) {
				const e = this.entries.get(k);
				if (e) this.factory.dispose(e.session);
				this.entries.delete(k);
				dropped = true;
			}
		}
		return dropped;
	}

	size(): number {
		return this.entries.size;
	}

	dispose(): void {
		for (const e of this.entries.values()) this.factory.dispose(e.session);
		this.entries.clear();
	}

	private sweep(): void {
		const now = Date.now();
		for (const [id, e] of this.entries) {
			if (now - e.lastUsed > this.idleMs) {
				this.factory.dispose(e.session);
				this.entries.delete(id);
			}
		}
	}
}
