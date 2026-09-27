# elmatadore-bot

Bot de Discord sobre o SDK do pi (`@earendil-works/pi-coding-agent`, versao fixa no `package.json`).
Arquitetura hexagonal com TDD obrigatorio; regras de trabalho em `AGENTS.md`.
Extraido de `felipebrgs1/discord-bot` (fork do pi); historico em `docs/historico-fork.md`.

```bash
bun install
bun run check    # tsc --noEmit
bun test         # bun:test em src/
bun start        # bun src/main/run.ts (le .env e data/bot.db na raiz)
bun scripts/seed.ts seed.json data/bot.db   # semeia config a partir de JSON
```

Ambiente (`.env` na raiz): `DISCORD_TOKEN` (obrigatorio), `CHAT_API_KEY` ou `OPENCODE_API_KEY`
(consolidacao de memoria), `DASHBOARD_PASSWORD`, `DASHBOARD_PORT` (0 desliga; padrao 8080),
`DASHBOARD_HOST`, `BOT_DB`, `YTDLP_BIN`, `AGENT_ALLOW_PRIVATE=1` (so para teste local).

Atualizar o pi: subir `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` juntos para a mesma versao, `bun install`, `bun run check && bun test`.

Painel: `web/` (workspace `discord-bot-web`, vitest: `bun run --cwd web test`).
