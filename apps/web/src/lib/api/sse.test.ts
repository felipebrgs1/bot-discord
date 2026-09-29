import { describe, expect, it } from "bun:test";
import { SseParser } from "./sse.ts";

function collect() {
	const events: { event: string; data: string }[] = [];
	const parser = new SseParser((event, data) => events.push({ event, data }));
	return { events, parser };
}

describe("SseParser", () => {
	it("emite um evento por quadro completo", () => {
		const { events, parser } = collect();
		parser.push('event: step\ndata: {"a":1}\n\nevent: done\ndata: {}\n\n');
		expect(events).toEqual([
			{ event: "step", data: '{"a":1}' },
			{ event: "done", data: "{}" },
		]);
	});

	it("junta quadro partido entre pedacos do stream", () => {
		const { events, parser } = collect();
		parser.push("event: acc");
		parser.push('epted\ndata: {"x"');
		expect(events).toEqual([]);
		parser.push(":2}\n\n");
		expect(events).toEqual([{ event: "accepted", data: '{"x":2}' }]);
	});

	it("sem linha event vira message; quadro sem data e ignorado", () => {
		const { events, parser } = collect();
		parser.push("data: oi\n\nevent: ping\n\n");
		expect(events).toEqual([{ event: "message", data: "oi" }]);
	});

	it("aceita CRLF", () => {
		const { events, parser } = collect();
		parser.push("event: done\r\ndata: {}\r\n\r\n");
		expect(events).toEqual([{ event: "done", data: "{}" }]);
	});
});
