/**
 * ElectionResults pelos arquivos publicos de resultado do TSE
 * (resultados.tse.jus.br, os mesmos do app Resultados). Um arquivo por
 * abrangencia e cargo: c0001 = presidente. Antes da apuracao o bucket responde 404/403.
 */

import type { ElectionRef, ElectionResults } from "@/application/ports/election-results.ts";
import type { AreaTally, CandidateTally } from "@/domain/election.ts";

export interface TseElectionResultsOptions {
	http?: typeof fetch;
	baseUrl?: string;
	timeoutMs?: number;
}

interface TseCandidate {
	n?: string;
	nmu?: string;
	e?: string;
	st?: string;
	vap?: string;
	pvap?: string;
}

interface TseResponse {
	dg?: string;
	hg?: string;
	carg?: { cd?: string; agr?: { par?: { cand?: TseCandidate[] }[] }[] }[];
	s?: { pst?: string };
	v?: { vb?: string; tvn?: string };
}

const DEFAULT_BASE = "https://resultados.tse.jus.br/oficial";

export class TseElectionResults implements ElectionResults {
	private readonly opts: TseElectionResultsOptions;

	constructor(opts: TseElectionResultsOptions = {}) {
		this.opts = opts;
	}

	async tally(ref: ElectionRef, area: string): Promise<AreaTally | null> {
		const http = this.opts.http ?? fetch;
		const base = (this.opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		const url = `${base}/${ref.cycle}/${ref.code}/dados/${area}/${area}-c0001-e${ref.code.padStart(6, "0")}-u.json`;
		const res = await http(url, { signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000) });
		if (res.status === 403 || res.status === 404) return null;
		if (!res.ok) throw new Error(`TSE HTTP ${res.status}`);
		const data = (await res.json()) as TseResponse;
		const office = data.carg?.find((c) => c.cd === "1");
		if (!office) throw new Error(`TSE ${area}: arquivo sem presidente`);
		const candidates: CandidateTally[] = (office.agr ?? []).flatMap((a) =>
			(a.par ?? []).flatMap((p) =>
				(p.cand ?? []).map((c) => ({
					number: c.n ?? "",
					name: c.nmu ?? "",
					votes: Number(c.vap ?? 0),
					pct: c.pvap ?? "0,00",
					// e=s tambem marca quem foi ao 2º turno; eleito so com st "Eleito".
					elected: c.e === "s" && c.st === "Eleito",
				})),
			),
		);
		return {
			area,
			updatedAt: `${data.dg ?? ""} ${data.hg ?? ""}`.trim(),
			sectionsPct: data.s?.pst ?? "0,00",
			candidates,
			blank: Number(data.v?.vb ?? 0),
			nulls: Number(data.v?.tvn ?? 0),
		};
	}
}
