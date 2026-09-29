import type { BinaryPage, PageFetcher } from "../../application/ports/page-fetcher.ts";

export interface FakeRoute {
	status?: number;
	body?: string;
	contentType?: string;
	bytes?: Uint8Array;
}

/** "Internet" do teste: primeira rota cujo regex casa responde; sem rota, lanca. */
export class FakePageFetcher implements PageFetcher {
	readonly requested: string[] = [];
	private readonly routes: [RegExp, FakeRoute][];

	constructor(routes: [RegExp, FakeRoute][] = []) {
		this.routes = routes;
	}

	async text(url: string, maxBytes = 2 << 20): Promise<{ status: number; text: string }> {
		const r = this.route(url);
		return { status: r.status ?? 200, text: (r.body ?? "").slice(0, maxBytes) };
	}

	async json(url: string): Promise<unknown> {
		const r = this.route(url);
		const status = r.status ?? 200;
		if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
		return JSON.parse(r.body ?? "null") as unknown;
	}

	async binary(url: string, maxBytes: number): Promise<BinaryPage> {
		const r = this.route(url);
		const bytes = r.bytes ?? new TextEncoder().encode(r.body ?? "");
		return {
			status: r.status ?? 200,
			contentType: r.contentType ?? "application/octet-stream",
			base64: bytes.byteLength > maxBytes ? null : Buffer.from(bytes).toString("base64"),
			size: bytes.byteLength,
		};
	}

	private route(url: string): FakeRoute {
		this.requested.push(url);
		for (const [re, r] of this.routes) if (re.test(url)) return r;
		throw new Error(`rota não mockada: ${url}`);
	}
}

/** Rotas usadas pela suite de contrato do PageFetcher. */
export const CONTRACT_ROUTES: [RegExp, FakeRoute][] = [
	[/\/ok$/, { body: "<p>ok</p>", contentType: "text/html" }],
	[/\/json$/, { body: '{"a":1}', contentType: "application/json" }],
	[/\/404$/, { status: 404, body: "nada" }],
	[/\/img$/, { contentType: "image/png", bytes: new Uint8Array(10) }],
];
