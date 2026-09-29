/**
 * Cliente do painel. Tipos de @elmatadore/api (o mesmo contrato do servidor);
 * fetch entra por parametro, sem global, para o teste trocar por um fake.
 */

import type * as Api from "@elmatadore/api";
import { SseParser } from "./sse.ts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiOptions {
	fetch: Fetch;
	/** 401 numa rota /api: o cookie venceu. */
	onUnauthorized: () => void;
}

export interface ChatHandlers {
	accepted?: (message: Api.ChatMessage) => void;
	step?: (step: Api.ChatStep) => void;
	done: (message: Api.ChatMessage, steps: Api.ChatStep[]) => void;
	error: (text: string) => void;
	signal?: AbortSignal;
}

const OFFLINE = "sem conexão com o servidor";
const EXPIRED = "sessão expirada, entre de novo";

function parse(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		// HTML onde se espera JSON = fallback do SPA: a rota nao existe nesse backend.
		if (raw.trimStart().startsWith("<")) throw new Error("o servidor devolveu HTML em vez de JSON: rota inexistente nesse backend");
		throw new Error("JSON inválido do servidor");
	}
}

function errorOf(raw: string, status: number): string {
	try {
		const data = JSON.parse(raw) as Partial<Api.ApiError> | null;
		if (typeof data?.error === "string") return data.error;
	} catch {
		/* corpo nao e JSON */
	}
	return raw && raw.length < 300 && !raw.trimStart().startsWith("<") ? raw : `erro HTTP ${status}`;
}

const put = (payload: unknown): RequestInit => ({
	method: "PUT",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(payload),
});

const post = (payload?: unknown): RequestInit =>
	payload === undefined
		? { method: "POST" }
		: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };

const seg = encodeURIComponent;

export function createApi({ fetch, onUnauthorized }: ApiOptions) {
	async function send(path: string, init?: RequestInit): Promise<Response> {
		let res: Response;
		try {
			res = await fetch(path, { cache: "no-store", ...init });
		} catch (err) {
			if (init?.signal?.aborted) throw err;
			throw new Error(OFFLINE);
		}
		if (res.status === 401 && path.startsWith("/api/")) {
			onUnauthorized();
			throw new Error(EXPIRED);
		}
		return res;
	}

	async function request<T>(path: string, init?: RequestInit): Promise<T> {
		const res = await send(path, init);
		if (res.status === 204) return undefined as T;
		const raw = await res.text();
		if (!res.ok) throw new Error(errorOf(raw, res.status));
		return parse(raw) as T;
	}

	async function sendChat(id: string, content: string, on: ChatHandlers): Promise<void> {
		let finished = false;
		const dispatch = (event: string, data: string) => {
			let payload: unknown;
			try {
				payload = JSON.parse(data);
			} catch {
				return; // quadro malformado nao derruba o resto
			}
			if (event === "accepted") on.accepted?.((payload as Api.ChatEvents["accepted"]).message);
			else if (event === "step") on.step?.(payload as Api.ChatEvents["step"]);
			else if (event === "done") {
				finished = true;
				const done = payload as Api.ChatEvents["done"];
				on.done(done.message, done.steps);
			} else if (event === "error") {
				finished = true;
				on.error((payload as Api.ChatEvents["error"]).message);
			}
		};

		try {
			const res = await send(`/api/chat/sessions/${seg(id)}/messages`, { ...post({ content } satisfies Api.SendChatRequest), signal: on.signal });
			if (!res.ok || !res.body) {
				on.error(errorOf(await res.text(), res.status));
				return;
			}
			const parser = new SseParser(dispatch);
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				parser.push(decoder.decode(value, { stream: true }));
			}
			if (!finished) on.error("o servidor encerrou a resposta sem concluir");
		} catch (err) {
			if (on.signal?.aborted) return;
			on.error(err instanceof Error && err.message === OFFLINE ? OFFLINE : "fluxo interrompido pelo servidor");
		}
	}

	return {
		session: async () => (await request<Api.AuthState>("/auth/session")).authenticated,
		login: async (password: string) => {
			await request<Api.AuthState>("/auth/login", post({ password } satisfies Api.LoginRequest));
		},
		logout: async () => {
			await request<Api.AuthState>("/auth/logout", post());
		},

		meta: () => request<Api.Meta>("/api/meta"),

		sessions: () => request<Api.ChatSessionList>("/api/chat/sessions"),
		history: (id: string) => request<Api.ChatHistory>(`/api/chat/sessions/${seg(id)}/messages`),
		deleteSession: (id: string) => request<void>(`/api/chat/sessions/${seg(id)}`, { method: "DELETE" }),
		sendChat,

		logs: (after: number, limit = 300) => request<Api.LogPage>(`/api/logs?after=${after}&limit=${limit}`),

		memories: (limit = 200) => request<Api.MemoryList>(`/api/memories?limit=${limit}`),
		memoryVersions: (id: number) => request<Api.MemoryVersionList>(`/api/memories/${id}/versions`),
		memoryAction: (id: number, action: Api.MemoryAction, reason: string) =>
			request<Api.Changed>(`/api/memories/${id}/${action}`, post({ reason } satisfies Api.MemoryActionRequest)),
		correctMemory: (id: number, content: string, reason: string) =>
			request<Api.Changed>(`/api/memories/${id}`, put({ content, reason } satisfies Api.MemoryCorrection)),
		learnings: (limit = 80) => request<Api.LearningList>(`/api/learnings?limit=${limit}`),

		metrics: () => request<Api.MetricsSnapshot>("/api/metrics"),

		discordConfig: () => request<Api.DiscordConfig>("/api/config/discord"),
		saveDiscordConfig: (form: Api.DiscordConfig) => request<Api.Saved>("/api/config/discord", put(form)),
		models: () => request<Api.ModelCatalog>("/api/models"),
		setModel: (model: string) => request<Api.ModelChanged>("/api/model", put({ model } satisfies Api.SetModelRequest)),

		participation: () => request<Api.ParticipationList>("/api/participation"),
	};
}

export type PanelApi = ReturnType<typeof createApi>;
