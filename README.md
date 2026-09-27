# elmatadore-bot

Bot de Discord sobre o SDK do pi (`@earendil-works/pi-coding-agent`, versao fixa no `package.json`).
Extraido de `felipebrgs1/discord-bot` (fork do pi); historico em `docs/historico-fork.md`.

```bash
bun install
bun run check    # tsc --noEmit
bun test         # bun:test em src/
bun start        # bun src/run.ts (le .env e data/bot.db na raiz)
```

Atualizar o pi: subir `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` juntos para a mesma versao, `bun install`, `bun run check && bun test`.

Painel: `web/` (workspace `discord-bot-web`, vitest: `bun run --cwd web test`).

Arquitetura e regras de trabalho: `AGENTS.md`.
