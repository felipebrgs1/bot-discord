/**
 * Aprendizado duravel (sem embeddings): um lote de mensagens + as memorias
 * atuais viram {summary, memories[], forget[], confirm[], episodes[]}. O modelo
 * ve o que ja sabe, entao atualiza (mesma key), esquece ou confirma em vez de
 * so empilhar. Aqui ficam o prompt e a validacao do que volta.
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

/** Aponta uma memoria existente. */
export interface MemoryRef {
	key: string;
	scope: MemoryScope;
	personId: string;
}

export interface ForgetRequest extends MemoryRef {
	reason: string;
}

export interface Extraction {
	summary: string;
	/** Novas ou atualizadas (mesma key = atualiza). */
	memories: ExtractedMemory[];
	/** Conhecidas que deixaram de valer. */
	forget: ForgetRequest[];
	/** Conhecidas reafirmadas no lote (sobem no ranking). */
	confirm: MemoryRef[];
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

const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

/** Ref valida: memoria conhecida e, se for de pessoa, ela falou no lote. */
function knownRef(c: Record<string, unknown>, authorIds: readonly string[], known: readonly MemoryHit[]): MemoryRef | undefined {
	const key = str(c["key"]).trim();
	const scope = str(c["scope"]);
	const personId = scope === "user" ? str(c["person_id"]) : "";
	if (scope === "user" && !authorIds.includes(personId)) return undefined;
	const hit = known.find((k) => k.key === key && k.scope === scope && k.personId === personId);
	return hit ? { key, scope: scope as MemoryScope, personId } : undefined;
}

/**
 * Valida o JSON do modelo. Memoria individual so da propria pessoa, que
 * precisa ter falado no lote; kind/scope fora da lista e descartado;
 * forget/confirm so de memoria conhecida.
 */
export function validateExtraction(raw: unknown, authorIds: readonly string[], known: readonly MemoryHit[]): Extraction {
	const v = (raw ?? {}) as Record<string, unknown>;
	const summary = str(v["summary"]).slice(0, 2000);
	const memories: ExtractedMemory[] = [];
	for (const c of list(v["memories"])) {
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
	for (const e of list(v["episodes"])) {
		const title = str(e["title"]).trim().slice(0, 200);
		const epSummary = str(e["summary"]).trim().slice(0, 1000);
		if (!title || !epSummary) continue;
		const key = str(e["key"]).trim() ? slug(str(e["key"])) : slug(title);
		if (!key) continue;
		episodes.push({ key, title, summary: epSummary });
	}
	const forget: ForgetRequest[] = [];
	for (const c of list(v["forget"])) {
		const ref = knownRef(c, authorIds, known);
		if (ref) forget.push({ ...ref, reason: str(c["reason"]).trim().slice(0, 300) });
	}
	const confirm: MemoryRef[] = [];
	for (const c of list(v["confirm"])) {
		const ref = knownRef(c, authorIds, known);
		if (ref) confirm.push(ref);
	}
	return { summary, memories, forget, confirm, episodes };
}

export function extractionPrompt(channelId: string, batch: readonly StoredMessage[], known: readonly MemoryHit[]): string {
	const lines = batch.map(
		(m) =>
			`[${m.createdAt.slice(0, 16).replace("T", " ")}] ${m.fromBot ? "[bot] " : ""}${m.authorName} (${m.authorId}): ${m.body.slice(0, 800)}`,
	);
	const current = known.map(
		(k) => `- key=${k.key} scope=${k.scope}${k.personId ? ` person_id=${k.personId}` : ""} (${k.kind}): ${k.content}`,
	);
	return `Você mantém a memória durável de um grupo de Discord (canal ${channelId}).
Responda SÓ com JSON: {"summary": "resumo do lote em 2-4 linhas", "memories": [...], "forget": [...], "confirm": [...], "episodes": [...]}.
Cada memory: {"key": "slug-estavel", "kind": "fact|preference|lesson|culture", "scope": "group|user", "person_id": "id ou vazio", "content": "frase autocontida"}.
Cada forget: {"key", "scope", "person_id", "reason"}: memória atual que deixou de valer (ex. "larguei o LoL").
Cada confirm: {"key", "scope", "person_id"}: memória atual reafirmada no lote, sem mudança.
Memórias atuais:
${current.length > 0 ? current.join("\n") : "(nenhuma)"}
Regras:
- Fato que mudou: reuse a MESMA key da memória atual com o conteúdo novo. Nunca crie key parecida para o mesmo assunto.
- forget e confirm só para memórias da lista acima.
- Só o que é DURÁVEL (fato, gosto, correção ao bot, piada interna com significado). Conversa casual = nada.
- scope user SOMENTE para declaração da própria pessoa (person_id = autor dela); resto é group.
- lesson só de correção concreta ao que o bot fez. culture sempre group.
- Linha marcada [bot] é fala de bot: nunca vira fato nem memória; só a correção que as pessoas fazem a ela.
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

/** Teto das memorias da pessoa no turno (vem ordenado por importancia). */
const MAX_MINE_CHARS = 800;

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
	const mine = fitLines(turn.mine.map(memoryLine), MAX_MINE_CHARS);
	if (mine.length > 0) parts.push(`[o que você lembra de ${turn.authorName}]`, ...mine);
	const recent = fitLines(
		turn.recent.map((r) => `${r.authorName}: ${r.body}`).reverse(),
		maxRecentChars,
	).reverse();
	if (recent.length > 0) parts.push("[conversa no canal desde sua última fala]", ...recent);
	if (parts.length > 1) parts.push("---");
	return [...parts, turn.text].join("\n");
}
