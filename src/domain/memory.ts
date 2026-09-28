/**
 * Aprendizado duravel (port do extrator do Go, sem embeddings): um lote de
 * mensagens vira {summary, memories[], episodes[]}. O modelo responde JSON;
 * aqui fica o prompt e a validacao do que volta.
 */

import type { StoredMessage } from "./message.ts";

export type MemoryKind = "fact" | "preference" | "lesson" | "culture";
export type MemoryScope = "group" | "user";
export type MemoryStatus = "active" | "suppressed";

export interface ExtractedMemory {
	key: string;
	kind: MemoryKind;
	scope: MemoryScope;
	personId: string;
	content: string;
}

export interface ExtractedEpisode {
	key: string;
	title: string;
	summary: string;
}

export interface Extraction {
	summary: string;
	memories: ExtractedMemory[];
	episodes: ExtractedEpisode[];
}

/** Memoria encontrada por busca. */
export interface MemoryHit {
	key: string;
	kind: string;
	scope: string;
	personId: string;
	content: string;
}

export interface FamiliarMemory {
	kind: string;
	content: string;
}

const KINDS: readonly string[] = ["fact", "preference", "lesson", "culture"];
const SCOPES: readonly string[] = ["group", "user"];

function slug(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Valida o JSON do modelo. Memoria individual so da propria pessoa, que
 * precisa ter falado no lote; kind/scope fora da lista e descartado.
 */
export function validateExtraction(raw: unknown, authorIds: readonly string[]): Extraction {
	const v = (raw ?? {}) as Record<string, unknown>;
	const summary = str(v["summary"]).slice(0, 2000);
	const memories: ExtractedMemory[] = [];
	for (const c of Array.isArray(v["memories"]) ? (v["memories"] as Record<string, unknown>[]) : []) {
		const kind = str(c["kind"]);
		const scope = str(c["scope"]);
		if (!KINDS.includes(kind) || !SCOPES.includes(scope)) continue;
		const person = str(c["person_id"]);
		if (scope === "user" && (!person || !authorIds.includes(person))) continue;
		const content = str(c["content"]).trim();
		if (!content || content.length > 1000) continue;
		const key = str(c["key"]).trim() ? slug(str(c["key"])) : slug(content);
		if (!key) continue;
		memories.push({
			key,
			kind: kind as MemoryKind,
			scope: scope as MemoryScope,
			personId: scope === "user" ? person : "",
			content,
		});
	}
	const episodes: ExtractedEpisode[] = [];
	for (const e of Array.isArray(v["episodes"]) ? (v["episodes"] as Record<string, unknown>[]) : []) {
		const title = str(e["title"]).trim().slice(0, 200);
		const epSummary = str(e["summary"]).trim().slice(0, 1000);
		if (!title || !epSummary) continue;
		const key = str(e["key"]).trim() ? slug(str(e["key"])) : slug(title);
		if (!key) continue;
		episodes.push({ key, title, summary: epSummary });
	}
	return { summary, memories, episodes };
}

export function extractionPrompt(channelId: string, batch: readonly StoredMessage[]): string {
	const lines = batch.map(
		(m) =>
			`[${m.createdAt.slice(0, 16).replace("T", " ")}] ${m.fromBot ? "[bot] " : ""}${m.authorName} (${m.authorId}): ${m.body.slice(0, 800)}`,
	);
	return `Você extrai aprendizado durável de conversa de Discord (canal ${channelId}).
Responda SÓ com JSON: {"summary": "resumo do lote em 2-4 linhas", "memories": [...], "episodes": [...]}.
Cada memory: {"key": "slug-estavel", "kind": "fact|preference|lesson|culture", "scope": "group|user", "person_id": "id ou vazio", "content": "frase autocontida"}.
Regras:
- Só o que é DURÁVEL (fato, gosto, correção ao bot, piada interna com significado). Conversa casual = nada.
- scope user SOMENTE para declaração da própria pessoa (person_id = autor dela); resto é group.
- lesson só de correção concreta ao que o bot fez. culture sempre group.
- Linha marcada [bot] é fala de bot: nunca vira fato nem memória; só a correção que as pessoas fazem a ela.
- Reutilize a mesma key quando o fato atualizar (ex. jogo-favorito).
- episodes: histórias do grupo com começo/meio (título + resumo). Vazio se não houver.
Mensagens:
${lines.join("\n")}`;
}

/** Linha da conversa recente do canal. */
export interface RecentLine {
	authorName: string;
	body: string;
}

export interface TurnInput {
	authorId: string;
	authorName: string;
	text: string;
	/** Memorias da pessoa que esta falando. */
	mine: readonly FamiliarMemory[];
	/** Conversa do canal desde a ultima fala do bot, antigas primeiro. */
	recent: readonly RecentLine[];
}

/** Linhas inteiras (na ordem) enquanto couberem em maxChars. */
function fitLines(lines: readonly string[], maxChars: number): string[] {
	const out: string[] = [];
	let used = 0;
	for (const line of lines) {
		used += line.length + (out.length > 0 ? 1 : 0);
		if (used > maxChars) break;
		out.push(line);
	}
	return out;
}

const memoryLine = (m: FamiliarMemory) => `- (${m.kind}) ${m.content}`;

/** Memoria do grupo no prompt da sessao ('' se nada). */
export function groupMemoryText(group: readonly FamiliarMemory[], maxChars = 1500): string {
	const lines = fitLines(group.map(memoryLine), maxChars);
	return lines.length > 0 ? `[memória do grupo]\n${lines.join("\n")}` : "";
}

/**
 * Texto do turno: a sessao e do canal (varias pessoas), entao cada mensagem
 * diz quem fala, o que o bot lembra dela e o que rolou desde a ultima fala dele.
 */
export function turnText(turn: TurnInput, maxRecentChars = 2000): string {
	const parts = [`[mensagem de ${turn.authorName} (id ${turn.authorId})]`];
	if (turn.mine.length > 0) parts.push(`[o que você lembra de ${turn.authorName}]`, ...turn.mine.map(memoryLine));
	const recent = fitLines(
		turn.recent.map((r) => `${r.authorName}: ${r.body}`).reverse(),
		maxRecentChars,
	).reverse();
	if (recent.length > 0) parts.push("[conversa no canal desde sua última fala]", ...recent);
	if (parts.length > 1) parts.push("---");
	return [...parts, turn.text].join("\n");
}
