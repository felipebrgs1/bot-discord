/** Operacoes do painel web: leitura de estado, curadoria de memoria e config. */

import { blockSize, type EditResult, MEMORY_LIMITS, type MemoryScope } from "@/domain/memory.ts";
import { roleOf } from "@/domain/roles.ts";
import { DEFAULT_SOUL } from "@/domain/soul.ts";
import type { Role } from "@/domain/roles.ts";
import type { ChatSessions } from "./ports/chat-agent.ts";
import type { ConfigStore } from "./ports/config-store.ts";
import type { LogEntry, LogFeed } from "./ports/log-feed.ts";
import type { AgentMemory } from "./agent-memory.ts";
import type { LearningEvent, MemoryAdmin, MemoryBlockRecord, MemoryBlockVersion } from "./ports/memory-admin.ts";
import type { MetricsQuery, MetricsSnapshot } from "./ports/metrics.ts";
import type { SoulStore } from "./ports/soul-store.ts";

export interface PanelDeps {
	config: ConfigStore;
	souls: SoulStore;
	sessions: ChatSessions;
	memories: MemoryAdmin;
	/** Escrita da memoria (mesmo teto da tool). */
	memory: AgentMemory;
	metrics: MetricsQuery;
	logs: LogFeed;
	/** Modelo da conversa (AGENT_MODEL); vazio = padrao do pi. */
	agentModel: string;
}

export interface DiscordForm {
	guild_id: string;
	channel_ids: string[];
	admin_ids: string[];
	web_user_id: string;
	personality: string;
}

export interface DiscordFormInput {
	guild_id?: string;
	channel_ids?: string[];
	admin_ids?: string[];
	web_user_id?: string;
	personality?: string;
}

const clamp = (value: number | undefined, fallback: number, max: number) =>
	Math.min(Math.max(value || fallback, 1), max);

export class Panel {
	private readonly deps: PanelDeps;

	constructor(deps: PanelDeps) {
		this.deps = deps;
	}

	meta(): { model: string; role: Role } {
		const s = this.deps.config.all();
		return { model: this.deps.agentModel || "(padrão do pi)", role: roleOf(s.dashboard.web_user_id, s.discord.admin_ids) };
	}

	logs(after: number, limit?: number): { entries: LogEntry[]; cursor: number } {
		return this.deps.logs.after(after, clamp(limit, 300, 1000));
	}

	memoryBlocks(): (MemoryBlockRecord & { size: number; limit: number })[] {
		return this.deps.memories.blocks().map((b) => ({ ...b, size: blockSize(b.entries), limit: MEMORY_LIMITS[b.scope] }));
	}

	memoryVersions(scope: MemoryScope, ownerId: string): MemoryBlockVersion[] {
		return this.deps.memories.versions(scope, ownerId);
	}

	/** Troca o bloco inteiro; acima do teto e erro. */
	saveMemory(scope: MemoryScope, ownerId: string, entries: readonly string[], reason?: string): EditResult {
		return this.deps.memory.replace({ scope, ownerId }, entries, reason || "editado pelo painel");
	}

	learnings(limit?: number): LearningEvent[] {
		return this.deps.memories.timeline(clamp(limit, 80, 200));
	}

	metrics(): MetricsSnapshot {
		return this.deps.metrics.snapshot();
	}

	discordForm(): DiscordForm {
		const s = this.deps.config.all();
		return {
			guild_id: s.discord.guild_id,
			channel_ids: s.discord.channel_ids,
			admin_ids: s.discord.admin_ids,
			web_user_id: s.dashboard.web_user_id,
			personality: this.deps.souls.get(DEFAULT_SOUL)?.body ?? s.bot.personality,
		};
	}

	/** A mente vigente mora na soul padrao: trocar derruba as sessoes (vale na proxima resposta). */
	saveDiscordForm(input: DiscordFormInput): void {
		const { config, souls, sessions } = this.deps;
		config.set("discord", {
			guild_id: input.guild_id ?? "",
			channel_ids: input.channel_ids ?? [],
			admin_ids: input.admin_ids ?? [],
		});
		if (input.web_user_id !== undefined) config.set("dashboard", { web_user_id: input.web_user_id });
		if (input.personality) {
			souls.save(DEFAULT_SOUL, input.personality);
			for (const conversation of sessions.conversations()) sessions.forget(conversation);
		}
	}

	model(): string {
		return this.deps.config.all().chat.model;
	}

	setModel(model: string): void {
		this.deps.config.set("chat.model", model);
	}
}
