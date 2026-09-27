/**
 * Uma AgentSession do pi por conversa+papel: user nunca reaproveita sessao
 * criada com tools de admin. Criada sob demanda, descartada quando ociosa.
 */

import type { ImageContent } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { canUseHostTools, type Role } from "../../../domain/roles.ts";

/** Tools nativas do pi que mexem na maquina do bot. */
const PI_HOST_TOOLS = ["bash", "powershell", "edit", "write", "read", "grep", "find", "ls"];

/**
 * Deny-list p/ createAgentSession. Vale na criacao da sessao; nao ha segundo
 * nivel de enforcement na execucao: sessao de user simplesmente nao recebe a tool.
 */
export function excludedToolsFor(role: Role): string[] {
	return canUseHostTools(role) ? [] : [...PI_HOST_TOOLS];
}

export interface SessionFactory {
	create(conversationId: string, role: Role, systemPrompt?: string): Promise<AgentSession>;
	dispose(session: AgentSession): void;
}

/** Fabrica real (auth/modelo do ~/.pi/agent; chave de API do ambiente). */
export function piSessionFactory(
	cwd: string,
	toolsFor: (conversationId: string, role: Role) => ToolDefinition[],
): SessionFactory {
	return {
		async create(conversationId, role, systemPrompt) {
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir: getAgentDir(),
				appendSystemPrompt: systemPrompt ? [systemPrompt] : [],
			});
			await loader.reload();
			const { session } = await createAgentSession({
				cwd,
				resourceLoader: loader,
				sessionManager: SessionManager.inMemory(),
				excludeTools: excludedToolsFor(role),
				customTools: toolsFor(conversationId, role),
			});
			return session;
		},
		dispose(session) {
			try {
				session.dispose();
			} catch {
				/* ja descartada */
			}
		},
	};
}

interface Entry {
	session: AgentSession;
	lastUsed: number;
}

export class SessionPool {
	private readonly entries = new Map<string, Entry>();
	private readonly factory: SessionFactory;
	private readonly idleMs: number;
	private readonly now: () => number;

	constructor(factory: SessionFactory, idleMs = 30 * 60 * 1000, now: () => number = Date.now) {
		this.factory = factory;
		this.idleMs = idleMs;
		this.now = now;
	}

	/** Sessao da conversa+papel; o prompt extra so vale se for criada agora. */
	async get(conversationId: string, role: Role, systemPrompt?: string): Promise<AgentSession> {
		this.sweep();
		const key = `${conversationId}::${role}`;
		const existing = this.entries.get(key);
		if (existing) {
			existing.lastUsed = this.now();
			return existing.session;
		}
		const session = await this.factory.create(conversationId, role, systemPrompt);
		this.entries.set(key, { session, lastUsed: this.now() });
		return session;
	}

	/** Pergunta e devolve o texto final do assistente. */
	async ask(session: AgentSession, text: string, images?: ImageContent[]): Promise<string> {
		await session.prompt(text, images?.length ? { images } : undefined);
		if (typeof session.waitForIdle === "function") await session.waitForIdle();
		return typeof session.getLastAssistantText === "function" ? (session.getLastAssistantText() ?? "") : "";
	}

	conversations(): string[] {
		this.sweep();
		return [...new Set([...this.entries.keys()].map((k) => k.split("::")[0] ?? ""))];
	}

	forget(conversationId: string): void {
		for (const [key, entry] of [...this.entries]) {
			if (key.startsWith(`${conversationId}::`)) {
				this.factory.dispose(entry.session);
				this.entries.delete(key);
			}
		}
	}

	size(): number {
		return this.entries.size;
	}

	dispose(): void {
		for (const e of this.entries.values()) this.factory.dispose(e.session);
		this.entries.clear();
	}

	private sweep(): void {
		const now = this.now();
		for (const [key, e] of this.entries) {
			if (now - e.lastUsed > this.idleMs) {
				this.factory.dispose(e.session);
				this.entries.delete(key);
			}
		}
	}
}
