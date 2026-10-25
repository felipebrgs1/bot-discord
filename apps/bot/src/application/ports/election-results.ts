import type { AreaTally } from "@/domain/election.ts";

/** Eleicao no TSE: ciclo ("ele2026") e codigo da eleicao ("6258" = 2º turno federal). */
export interface ElectionRef {
	cycle: string;
	code: string;
}

/** Resultado oficial de presidente por abrangencia ("br", "zz" ou UF minuscula). */
export interface ElectionResults {
	/** null: resultado ainda nao publicado. Lanca em outra falha. */
	tally(ref: ElectionRef, area: string): Promise<AreaTally | null>;
}
