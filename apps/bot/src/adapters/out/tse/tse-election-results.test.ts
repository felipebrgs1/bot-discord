import { describe, expect, it } from "bun:test";
import { TseElectionResults } from "./tse-election-results.ts";

/** Recorte do dados/<uf>/<uf>-c0001-e<eleicao>-u.json do TSE (formato de 2026). */
const BODY = {
	ele: "6258",
	tpabr: "uf",
	cdabr: "sp",
	dg: "25/10/2026",
	hg: "19:30:12",
	carg: [
		{
			cd: "1",
			nmn: "Presidente",
			agr: [
				{
					n: "280001801177",
					par: [
						{
							n: "22",
							sg: "PL",
							cand: [{ n: "22", nm: "FLAVIO NANTES BOLSONARO", nmu: "FLAVIO BOLSONARO", e: "n", st: "Não eleito", vap: "12345678", pvap: "49,10" }],
						},
					],
				},
				{
					n: "280001800617",
					par: [
						{ n: "13", sg: "PT", cand: [{ n: "13", nm: "LUIZ INÁCIO LULA DA SILVA", nmu: "LULA", e: "s", st: "Eleito", vap: "12800000", pvap: "50,90" }] },
						{ n: "40", sg: "PSB", cand: [] },
					],
				},
			],
		},
	],
	s: { ts: "100", st: "87", pst: "87,32" },
	v: { tv: "26000000", vb: "300000", tvn: "554322" },
};

function fakeHttp(status: number, body: unknown) {
	const urls: string[] = [];
	const http = (async (url: string) => {
		urls.push(url);
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
	return { http, urls };
}

const REF = { cycle: "ele2026", code: "6258" };

describe("TseElectionResults", () => {
	it("busca o arquivo de presidente da abrangencia e traduz candidatos, secoes e brancos/nulos", async () => {
		const { http, urls } = fakeHttp(200, BODY);
		const tally = await new TseElectionResults({ http }).tally(REF, "sp");
		expect(urls).toEqual(["https://resultados.tse.jus.br/oficial/ele2026/6258/dados/sp/sp-c0001-e006258-u.json"]);
		expect(tally).toEqual({
			area: "sp",
			updatedAt: "25/10/2026 19:30:12",
			sectionsPct: "87,32",
			candidates: [
				{ number: "22", name: "FLAVIO BOLSONARO", votes: 12_345_678, pct: "49,10", elected: false },
				{ number: "13", name: "LULA", votes: 12_800_000, pct: "50,90", elected: true },
			],
			blank: 300_000,
			nulls: 554_322,
		});
	});

	it("candidato que vai ao 2º turno (e=s) nao conta como eleito", async () => {
		const first = structuredClone(BODY);
		const lula = first.carg[0]?.agr[1]?.par[0]?.cand[0];
		if (lula) lula.st = "2º turno";
		const { http } = fakeHttp(200, first);
		const tally = await new TseElectionResults({ http }).tally(REF, "br");
		expect(tally?.candidates.every((c) => !c.elected)).toBe(true);
	});

	it("arquivo ainda nao publicado (404 ou 403 do bucket) e null", async () => {
		for (const status of [403, 404]) {
			const { http } = fakeHttp(status, "<Error><Code>NoSuchKey</Code></Error>");
			expect(await new TseElectionResults({ http }).tally(REF, "br")).toBeNull();
		}
	});

	it("outro erro HTTP ou JSON sem o cargo lanca", async () => {
		await expect(new TseElectionResults({ http: fakeHttp(500, "x").http }).tally(REF, "br")).rejects.toThrow("TSE HTTP 500");
		await expect(new TseElectionResults({ http: fakeHttp(200, { carg: [] }).http }).tally(REF, "br")).rejects.toThrow("sem presidente");
	});

	it("usa a base dada (espelho ou simulado)", async () => {
		const { http, urls } = fakeHttp(200, BODY);
		await new TseElectionResults({ http, baseUrl: "https://espelho.example/oficial/" }).tally({ cycle: "ele2026", code: "6257" }, "zz");
		expect(urls).toEqual(["https://espelho.example/oficial/ele2026/6257/dados/zz/zz-c0001-e006257-u.json"]);
	});
});
