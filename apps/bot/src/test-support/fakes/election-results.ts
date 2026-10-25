import type { ElectionRef, ElectionResults } from "@/application/ports/election-results.ts";
import type { AreaTally } from "@/domain/election.ts";

/** TSE do teste: area sem entrada ainda nao foi publicada; area em `failing` lanca. */
export class FakeElectionResults implements ElectionResults {
	readonly areas = new Map<string, AreaTally>();
	readonly failing = new Set<string>();
	readonly requested: string[] = [];
	readonly refs: ElectionRef[] = [];

	async tally(ref: ElectionRef, area: string): Promise<AreaTally | null> {
		this.refs.push(ref);
		this.requested.push(area);
		if (this.failing.has(area)) throw new Error("TSE caiu");
		return this.areas.get(area) ?? null;
	}
}
