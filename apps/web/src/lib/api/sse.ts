/**
 * Leitor incremental de Server-Sent Events. O chat e um POST que responde SSE,
 * entao nao da para usar EventSource: o stream chega em pedacos arbitrarios
 * e o parser junta ate fechar cada quadro (linha em branco).
 */
export class SseParser {
	private readonly onEvent: (event: string, data: string) => void;
	private buffer = "";

	constructor(onEvent: (event: string, data: string) => void) {
		this.onEvent = onEvent;
	}

	push(chunk: string): void {
		this.buffer += chunk.replace(/\r\n/g, "\n");
		let end: number;
		while ((end = this.buffer.indexOf("\n\n")) >= 0) {
			const frame = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end + 2);
			let event = "message";
			let data = "";
			for (const line of frame.split("\n")) {
				if (line.startsWith("event:")) event = line.slice(6).trim();
				else if (line.startsWith("data:")) data += line.slice(5).trim();
			}
			if (data) this.onEvent(event, data);
		}
	}
}
