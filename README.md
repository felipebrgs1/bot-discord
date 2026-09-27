# elmatadore-bot

Bot de Discord sobre o SDK do pi (`@earendil-works/pi-coding-agent`, versao fixa no `package.json`).
Extraido de `felipebrgs1/discord-bot` (fork do pi); historico em `docs/historico-fork.md`.

```bash
pnpm install --ignore-scripts
pnpm run check   # tsc --noEmit
pnpm test        # vitest --run
pnpm start       # node src/run.ts (le .env e data/bot.db na raiz)
```

Atualizar o pi: subir `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` juntos para a mesma versao, `pnpm install`, `pnpm run check && pnpm test`.

Painel: `web/` (workspace pnpm `discord-bot-web`).
