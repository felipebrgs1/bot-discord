/** Operacoes do painel web: leitura de estado, curadoria de memoria e config. */

import { roleOf } from "../domain/roles.ts";
import { DEFAULT_SOUL } from "../domain/soul.ts";
import type { Role } from "../domain/roles.ts";
import type { ChatSessions } from "./ports/chat-agent.ts";
import type { ConfigStore } from "./ports/config-store.ts";
import type { LogEntry, LogFeed } from "./ports/log-feed.ts";
import type { LearningEvent, MemoryAdmin, MemoryRecord, MemoryVersion } from "./ports/memory-admin.ts";
import type { MetricsQuery, MetricsSnapshot } from "./ports/metrics.ts";
import type { SoulStore } from "./ports/soul-store.ts";

export interface PanelDeps {
	config: ConfigStore;
	souls: SoulStore;
	sessions: ChatSessions;
	memories: MemoryAdmin;
	metrics: MetricsQuery;
	logs: LogFeed;
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
		return { model: s.chat.model || "(padrão do pi)", role: roleOf(s.dashboard.web_user_id, s.discord.admin_ids) };
	}

	logs(after: number, limit?: number): { entries: LogEntry[]; cursor: number } {
		return this.deps.logs.after(after, clamp(limit, 300, 1000));
	}

	memories(limit?: number): MemoryRecord[] {
		return this.deps.memories.listActive(clamp(limit, 200, 500));
	}

	memoryVersions(id: number): { memory: MemoryRecord; versions: MemoryVersion[] } | undefined {
		const memory = this.deps.memories.find(id);
		return memory ? { memory, versions: this.deps.memories.versions(id) } : undefined;
	}

	forget(id: number, reason?: string): boolean {
		return this.deps.memories.setStatus(id, "suppressed", reason || "esquecido pelo painel");
	}

	restore(id: number, reason?: string): boolean {
		return this.deps.memories.setStatus(id, "active", reason || "restaurado pelo painel");
	}

	/** Lanca "conteúdo vazio"; false se a memoria nao existe. */
	correct(id: number, content: string, reason?: string): boolean {
		if (!content.trim()) throw new Error("conteúdo vazio");
		return this.deps.memories.correct(id, content, reason ?? "corrigido pelo painel");
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
