/**
 * Memoria em blocos (modelo do Hermes): um bloco do grupo por canal e um por
 * pessoa, cada um uma lista curta de entradas com teto de caracteres. O bloco
 * entra inteiro no prompt; escrever e add/replace/remove, e passar do teto e
 * erro que obriga a consolidar (juntar ou apagar) em vez de empilhar.
 */

import type { StoredMessage } from "./message.ts";

export type MemoryScope = "group" | "user";

/** Bloco do grupo (ownerId = canal) ou de uma pessoa (ownerId = id do Discord). */
export interface MemoryBlockRef {
	scope: MemoryScope;
	ownerId: string;
}

export const MEMORY_LIMITS: Record<MemoryScope, number> = { group: 2200, user: 1375 };

export type MemoryEdit =
	| { action: "add"; content: string }
	| { action: "replace"; oldText: string; content: string }
	| { action: "remove"; oldText: string };

export type EditResult = { ok: true; entries: string[] } | { ok: false; error: string };

/** Entrada e uma linha so: espacos e quebras viram um espaco. */
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();

/** Entradas mais a quebra entre elas. */
export function blockSize(entries: readonly string[]): number {
	return entries.reduce((n, e) => n + e.length, 0) + Math.max(entries.length - 1, 0);
}

/** Indice da unica entrada que contem o trecho, ou o erro. */
function locate(entries: readonly string[], oldText: string): number | string {
	const needle = normalize(oldText).toLowerCase();
	if (!needle) return "old_text vazio: passe um trecho da entrada";
	const hits = entries.flatMap((e, i) => (e.toLowerCase().includes(needle) ? [i] : []));
	if (hits.length === 0) return `nenhuma entrada contém "${oldText}"`;
	if (hits.length > 1) return `trecho ambíguo: ${hits.length} entradas contêm "${oldText}"; use um trecho maior`;
	return hits[0] ?? -1;
}

/** Teto so barra o que cresce: encolher sempre pode (teto baixado ou bloco antigo). */
function withinLimit(before: readonly string[], next: string[], limit: number): EditResult {
	const size = blockSize(next);
	if (size > limit && size > blockSize(before)) {
		return {
			ok: false,
			error: `memória cheia: ficaria com ${size}/${limit} caracteres. Junte entradas parecidas (replace) ou apague o que perdeu valor (remove) e tente de novo.`,
		};
	}
	return { ok: true, entries: next };
}

/** Troca o bloco inteiro (painel): mesma normalizacao e mesmo teto das edicoes. */
export function replaceBlock(before: readonly string[], next: readonly string[], limit: number): EditResult {
	return withinLimit(before, next.map(normalize).filter(Boolean), limit);
}

export function applyMemoryEdit(entries: readonly string[], edit: MemoryEdit, limit: number): EditResult {
	let next: string[];
	if (edit.action === "add") {
		const content = normalize(edit.content);
		if (!content) return { ok: false, error: "conteúdo vazio" };
		if (entries.some((e) => e.toLowerCase() === content.toLowerCase())) return { ok: false, error: "essa entrada já existe" };
		next = [...entries, content];
	} else {
		const at = locate(entries, edit.oldText);
		if (typeof at === "string") return { ok: false, error: at };
		if (edit.action === "remove") {
			next = entries.filter((_, i) => i !== at);
		} else {
			const content = normalize(edit.content);
			if (!content) return { ok: false, error: "conteúdo vazio; para apagar use remove" };
			next = entries.map((e, i) => (i === at ? content : e));
		}
	}
	return withinLimit(entries, next, limit);
}

export function memoryBlockText(title: string, entries: readonly string[], limit: number): string {
	const body = entries.length > 0 ? entries.map((e) => `- ${e}`).join("\n") : "(vazia)";
	return `[${title}] (${blockSize(entries)}/${limit})\n${body}`;
}

/** Como o bot usa e mantem a memoria; vai no prompt da sessao. */
export const MEMORY_GUIDANCE = `[como usar sua memória]
Você tem uma memória curta e durável: um bloco do grupo (abaixo) e um bloco de cada pessoa (vem junto da mensagem dela).
- Use a memória só quando ela tiver a ver com o assunto. Não force piada interna nem fato antigo em resposta que não pede.
- Salve com a tool memory quando alguém corrigir você, disser uma preferência que vale para sempre ou contar um fato durável. Papo do dia, notícia e opinião passageira não entram.
- Cada entrada é uma frase curta e autocontida. Se a memória estiver cheia, junte entradas parecidas ou apague a que perdeu valor antes de adicionar.`;

export interface RecentLine {
	authorName: string;
	body: string;
}

export interface TurnInput {
	authorId: string;
	authorName: string;
	text: string;
	/** Bloco de memoria da pessoa que fala. */
	memory: readonly string[];
	/** Conversa do canal desde a ultima fala do bot, antigas primeiro. */
	recent: readonly RecentLine[];
	/** Imagens anexadas vieram de mensagens anteriores do canal, nao desta. */
	borrowedImages?: boolean;
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

/**
 * Texto do turno: a sessao e do canal (varias pessoas), entao cada mensagem
 * diz quem fala, a memoria dela e o que rolou desde a ultima fala do bot,
 * deixando claro que so a ultima parte e a pergunta.
 */
export function turnText(turn: TurnInput, maxRecentChars = 2000): string {
	const parts = [`[mensagem de ${turn.authorName} (id ${turn.authorId})]`];
	if (turn.memory.length > 0) parts.push(memoryBlockText(`memória de ${turn.authorName}`, turn.memory, MEMORY_LIMITS.user));
	const recent = fitLines(
		turn.recent.map((r) => `${r.authorName}: ${r.body}`).reverse(),
		maxRecentChars,
	).reverse();
	if (recent.length > 0) parts.push("[conversa recente no canal: só contexto, não é pergunta para você]", ...recent);
	if (turn.borrowedImages) {
		parts.push(
			"[as imagens anexadas são de mensagens anteriores do canal, não desta: só contexto; comente só se a pergunta for sobre elas]",
		);
	}
	if (parts.length > 1) parts.push(`[responda só a esta mensagem de ${turn.authorName}]`);
	return [...parts, turn.text].join("\n");
}

export interface ReviewBlocks {
	group: readonly string[];
	people: readonly { personId: string; name: string; entries: readonly string[] }[];
}

/** Revisao em segundo plano: o modelo ve o lote e os blocos e propoe edicoes. */
export function reviewPrompt(batch: readonly StoredMessage[], blocks: ReviewBlocks): string {
	const lines = batch.map(
		(m) =>
			`[${m.createdAt.slice(0, 16).replace("T", " ")}] ${m.fromBot ? "[bot] " : ""}${m.authorName} (${m.authorId}): ${m.body.slice(0, 800)}`,
	);
	const current = [
		memoryBlockText("memória do grupo", blocks.group, MEMORY_LIMITS.group),
		...blocks.people.map((p) => memoryBlockText(`memória de ${p.name} (person_id ${p.personId})`, p.entries, MEMORY_LIMITS.user)),
	];
	return `Você cuida da memória durável de um bot de Discord. A memória é pequena de propósito e entra inteira em toda conversa.
Responda SÓ com JSON: {"edits": [...]}. Sem nada para mudar: {"edits": []} (o caso mais comum).
Cada edit: {"target": "group|user", "person_id": "id (só em user)", "action": "add|replace|remove", "old_text": "trecho único da entrada (replace/remove)", "content": "frase curta (add/replace)"}.
Memória atual:
${current.join("\n")}
Regras:
- Só o que é durável e útil em conversa futura: correção que alguém fez ao bot, preferência declarada, fato estável sobre a pessoa ou o grupo, piada interna recorrente. Papo do dia, notícia, opinião passageira e o que já está na memória = nada.
- target user só para o que a própria pessoa disse de si (person_id = autor da mensagem). O resto é group.
- Fato que mudou: replace na entrada antiga, nunca uma entrada nova parecida.
- Respeite o teto entre parênteses: se não couber, junte entradas parecidas (replace) ou apague a de menor valor (remove) antes do add.
- Linha marcada [bot] é fala de bot: nunca vira memória; só a correção que as pessoas fazem a ela.
Mensagens:
${lines.join("\n")}`;
}

export interface ReviewEdit {
	ref: MemoryBlockRef;
	edit: MemoryEdit;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Edicoes validas do JSON da revisao; pessoa so se falou no lote. */
export function parseReviewEdits(raw: unknown, channelId: string, authorIds: readonly string[]): ReviewEdit[] {
	const list = (raw as { edits?: unknown } | null)?.edits;
	if (!Array.isArray(list)) return [];
	const out: ReviewEdit[] = [];
	for (const item of list as Record<string, unknown>[]) {
		const target = str(item["target"]);
		const person = str(item["person_id"]);
		let ref: MemoryBlockRef;
		if (target === "group") ref = { scope: "group", ownerId: channelId };
		else if (target === "user" && authorIds.includes(person)) ref = { scope: "user", ownerId: person };
		else continue;
		const action = str(item["action"]);
		const content = str(item["content"]);
		const oldText = str(item["old_text"]);
		if (action === "add" && content) out.push({ ref, edit: { action, content } });
		else if (action === "replace" && oldText && content) out.push({ ref, edit: { action, oldText, content } });
		else if (action === "remove" && oldText) out.push({ ref, edit: { action, oldText } });
	}
	return out;
}
