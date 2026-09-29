/**
 * Uma AgentSession do pi por conversa+papel: user nunca reaproveita sessao
 * criada com tools de admin. Criada sob demanda, descartada quando ociosa.
 */

import type { Api, ImageContent, Model } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { formatModelRef, type ModelRef } from "../../../domain/model-ref.ts";
import { canUseHostTools, type Role } from "../../../domain/roles.ts";
import type { WorkerFactory } from "./pi-sub-agents.ts";

/** Tools nativas do pi que mexem na maquina do bot. */
const PI_HOST_TOOLS = ["bash", "powershell", "edit", "write", "read", "grep", "find", "ls"];

/**
 * Deny-list p/ createAgentSession. Vale na criacao da sessao; nao ha segundo
 * nivel de enforcement na execucao: sessao de user simplesmente nao recebe a tool.
 */
export function excludedToolsFor(role: Role): string[] {
	return canUseHostTools(role) ? [] : [...PI_HOST_TOOLS];
}

export interface BotLoaderOptions {
	cwd: string;
	agentDir: string;
	/** Personalidade base (substitui o prompt de programacao do pi). */
	personality: string;
	/** Complemento da conversa (soul do canal + memoria). */
	extra?: string;
}

/**
 * O bot nao e um agente de programacao: nada de AGENTS.md, SYSTEM.md, skills,
 * extensions ou templates da maquina. So a personalidade e o complemento.
 */
export function botResourceLoader(opts: BotLoaderOptions): DefaultResourceLoader {
	return new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir: opts.agentDir,
		noContextFiles: true,
		noSkills: true,
		noExtensions: true,
		noPromptTemplates: true,
		systemPrompt: opts.personality,
		appendSystemPrompt: opts.extra ? [opts.extra] : [],
	});
}

export interface SessionFactory {
	create(conversationId: string, role: Role, systemPrompt?: string): Promise<AgentSession>;
	dispose(session: AgentSession): void;
}

/** O que resolveModel precisa do catalogo do pi (ModelRuntime). */
export interface ModelCatalog<M> {
	getModel(provider: string, id: string): M | undefined;
	hasConfiguredAuth(provider: string): boolean;
}

/** Modelo do catalogo do pi; lanca com mensagem acionavel se nao existe ou falta login. */
export function resolveModel<M>(catalog: ModelCatalog<M>, ref: ModelRef): M {
	const model = catalog.getModel(ref.provider, ref.id);
	if (!model) throw new Error(`AGENT_MODEL ${formatModelRef(ref)} não existe no pi`);
	if (!catalog.hasConfiguredAuth(ref.provider)) {
		throw new Error(`sem credencial para ${ref.provider}: rode \`pi\` e faça /login ou configure a chave`);
	}
	return model;
}

type Pinned = { modelRuntime: ModelRuntime; model: Model<Api> } | Record<string, never>;

/** Catalogo do pi carregado uma vez; falha nao fica em cache (login feito depois vale). */
function modelPin(model?: ModelRef): () => Promise<Pinned> {
	let pinned: Promise<Pinned> | undefined;
	return () => {
		if (!model) return Promise.resolve({});
		return (pinned ??= ModelRuntime.create()
			.then((modelRuntime) => ({ modelRuntime, model: resolveModel(modelRuntime, model) }))
			.catch((err: unknown) => {
				pinned = undefined;
				throw err;
			}));
	};
}

interface OpenOptions {
	cwd: string;
	pin: () => Promise<Pinned>;
	personality: string;
	extra?: string;
	role: Role;
	tools: ToolDefinition[];
}

async function openSession(opts: OpenOptions): Promise<AgentSession> {
	const chosen = await opts.pin();
	const loader = botResourceLoader({ cwd: opts.cwd, agentDir: getAgentDir(), personality: opts.personality, extra: opts.extra });
	await loader.reload();
	const { session } = await createAgentSession({
		cwd: opts.cwd,
		...chosen,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		excludeTools: excludedToolsFor(opts.role),
		customTools: opts.tools,
	});
	return session;
}

function disposeSession(session: AgentSession): void {
	try {
		session.dispose();
	} catch {
		/* ja descartada */
	}
}

/**
 * Fabricas reais (auth do ~/.pi/agent; chave de API do ambiente). Com `model`
 * (AGENT_MODEL), toda sessao usa esse modelo; sem, vale o padrao do pi.
 */
export function piSessionFactories(
	cwd: string,
	toolsFor: (conversationId: string, role: Role) => ToolDefinition[],
	personality: () => string,
	model?: ModelRef,
): { conversations: SessionFactory; workers: WorkerFactory } {
	const pin = modelPin(model);
	return {
		conversations: {
			create: (conversationId, role, systemPrompt) =>
				openSession({ cwd, pin, personality: personality(), extra: systemPrompt, role, tools: toolsFor(conversationId, role) }),
			dispose: disposeSession,
		},
		// Worker do swarm: sem persona e sempre como user (nada de shell ou arquivo).
		workers: {
			create: (conversationId, instructions, tools) =>
				openSession({ cwd, pin, personality: instructions, role: "user", tools: tools ? toolsFor(conversationId, "user") : [] }),
			dispose: disposeSession,
		},
	};
}

/** Pergunta e devolve o texto final do assistente; erro do provedor lanca. */
export async function askSession(session: AgentSession, text: string, images?: ImageContent[]): Promise<string> {
	await session.prompt(text, images?.length ? { images } : undefined);
	if (typeof session.waitForIdle === "function") await session.waitForIdle();
	// Erro do provedor (rate limit, rede...) fica so na mensagem; sem isso vira resposta vazia.
	const last = session.messages?.findLast((m) => m.role === "assistant");
	if (last?.role === "assistant" && last.stopReason === "error") {
		throw new Error(last.errorMessage ?? "erro do provedor");
	}
	return typeof session.getLastAssistantText === "function" ? (session.getLastAssistantText() ?? "") : "";
}

interface Entry {
	session: AgentSession;
	createdAt: number;
	lastUsed: number;
}

export class SessionPool {
	private readonly entries = new Map<string, Entry>();
	private readonly factory: SessionFactory;
	private readonly idleMs: number;
	private readonly now: () => number;
	/** Mesmo em uso, a sessao e recriada: o prompt (soul + memoria do grupo) atualiza. */
	private readonly maxAgeMs: number;

	constructor(
		factory: SessionFactory,
		idleMs = 30 * 60 * 1000,
		now: () => number = Date.now,
		maxAgeMs = 3 * 60 * 60 * 1000,
	) {
		this.factory = factory;
		this.idleMs = idleMs;
		this.now = now;
		this.maxAgeMs = maxAgeMs;
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
		this.entries.set(key, { session, createdAt: this.now(), lastUsed: this.now() });
		return session;
	}

	/** Pergunta e devolve o texto final do assistente. */
	ask(session: AgentSession, text: string, images?: ImageContent[]): Promise<string> {
		return askSession(session, text, images);
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
			if (now - e.lastUsed > this.idleMs || now - e.createdAt > this.maxAgeMs) {
				this.factory.dispose(e.session);
				this.entries.delete(key);
			}
		}
	}
}

