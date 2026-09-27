/**
 * Troca o fetch global nos testes. Provisorio: some quando o codigo
 * pre-hexagonal receber fetch pela porta PageFetcher.
 */
const original = globalThis.fetch;

/** Aceita respostas parciais: o codigo testado so le alguns campos. */
export function replaceFetch(fake: (...args: never[]) => Promise<unknown>): void {
	globalThis.fetch = fake as unknown as typeof fetch;
}

export function restoreFetch(): void {
	globalThis.fetch = original;
}
