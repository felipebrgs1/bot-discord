import { describe, expect, it } from "bun:test";
import { htmlToText, unescapeHtml } from "./html-text.ts";

describe("htmlToText", () => {
	it("tira script/style, filtra linha curta e pega o titulo", () => {
		const { title, text } = htmlToText(
			"<html><head><title>T</title><style>.a{}</style></head><body>\n<p>linha longa o bastante para sobreviver ao filtro mínimo aplicado aqui</p>\n<p>curta</p>\n<script>var x=1;</script></body></html>",
		);
		expect(title).toBe("T");
		expect(text).toBe("linha longa o bastante para sobreviver ao filtro mínimo aplicado aqui");
	});

	it("desescapa entidades no titulo e no texto", () => {
		const { title } = htmlToText("<title>Tom &amp; Jerry &#39;99</title>");
		expect(title).toBe("Tom & Jerry '99");
	});
});

describe("unescapeHtml", () => {
	it("entidades comuns e numericas", () => {
		expect(unescapeHtml("&lt;a&gt; &quot;b&quot; &#038; c")).toBe('<a> "b" & c');
	});
});
