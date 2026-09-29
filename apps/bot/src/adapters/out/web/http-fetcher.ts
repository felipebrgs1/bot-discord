/** PageFetcher sobre fetch: UA de navegador, timeout de 20s, guarda SSRF antes de cada pedido. */

import type { HostGuard } from "../../../application/ports/host-guard.ts";
import type { BinaryPage, PageFetcher } from "../../../application/ports/page-fetcher.ts";

export const BROWSER_UA =
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export interface HttpFetcherOptions {
	guard: HostGuard;
	http?: typeof fetch;
	timeoutMs?: number;
}

export class HttpPageFetcher implements PageFetcher {
	private readonly guard: HostGuard;
	private readonly http: typeof fetch;
	private readonly timeoutMs: number;

	constructor(opts: HttpFetcherOptions) {
		this.guard = opts.guard;
		this.http = opts.http ?? fetch;
		this.timeoutMs = opts.timeoutMs ?? 20_000;
	}

	async text(url: string, maxBytes = 2 << 20): Promise<{ status: number; text: string }> {
		const res = await this.get(url, "text/html,application/xhtml+xml,text/plain");
		const buf = await res.arrayBuffer();
		return { status: res.status, text: new TextDecoder().decode(buf.slice(0, maxBytes)) };
	}

	async json(url: string): Promise<unknown> {
		const res = await this.get(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return (await res.json()) as unknown;
	}

	async binary(url: string, maxBytes: number): Promise<BinaryPage> {
		const res = await this.get(url);
		const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
		const buf = await res.arrayBuffer();
		const size = buf.byteLength;
		return {
			status: res.status,
			contentType,
			base64: size > maxBytes ? null : Buffer.from(buf).toString("base64"),
			size,
		};
	}

	private async get(url: string, accept?: string): Promise<Response> {
		await this.guard.assertPublic(new URL(url).host);
		return this.http(url, {
			headers: accept ? { "User-Agent": BROWSER_UA, Accept: accept } : { "User-Agent": BROWSER_UA },
			signal: AbortSignal.timeout(this.timeoutMs),
		});
	}
}
