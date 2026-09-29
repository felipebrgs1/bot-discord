const integer = new Intl.NumberFormat("pt-BR");
const oneDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const compactFmt = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 });

type Maybe = number | null | undefined;
// Intl usa espaco nao quebravel em "mil" e "US$"; normaliza para comparar e copiar.
const or = (x: Maybe, f: (n: number) => string) => (x == null ? "—" : f(x).replace(/\u00a0/g, " "));

export const num = (x: Maybe) => or(x, (n) => integer.format(n));
export const compact = (x: Maybe) => or(x, (n) => compactFmt.format(n));
export const money = (x: Maybe) => or(x, (n) => usd.format(n).replace(/ /g, " "));
export const percent = (x: Maybe) => or(x, (n) => `${oneDecimal.format(n)}%`);
export const latency = (x: Maybe) => or(x, (n) => (n >= 1000 ? `${oneDecimal.format(n / 1000)} s` : `${oneDecimal.format(n)} ms`));

export const time = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour12: false });
export const dateTime = (iso: string) =>
	new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
