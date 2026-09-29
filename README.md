# elmatadore-bot

Bot de Discord com IA. Conversa nos canais, lembra do que aprende, pesquisa na web
e baixa midia, com um painel web para configurar e acompanhar.

Construido sobre o SDK do pi (`@earendil-works/pi-coding-agent`), com arquitetura
hexagonal e TDD. Regras de trabalho em `AGENTS.md`.

## Funcionalidades

- Respostas com agente de IA, com gatilhos, cooldown e papeis configuraveis
- Memoria de longo prazo por canal, com consolidacao periodica
- Ferramentas do agente: busca na web, leitura de paginas, download de midia e imagens
- Painel web: chat, logs, memorias, metricas e configuracao

## Requisitos

- [Bun](https://bun.sh) >= 1.4
- Token de bot do Discord
- `yt-dlp` (opcional, para download de midia)

## Estrutura

Monorepo (workspaces do Bun + Turborepo):

- `apps/bot`: o bot
- `apps/web`: painel web (React + Vite) e o Worker da Cloudflare
- `packages/api`: contrato HTTP do painel, compartilhado entre bot, Worker e painel
- `packages/tsconfig`: configuracao estrita do TypeScript

## Uso

```bash
bun install
cp apps/bot/.env.example apps/bot/.env    # preencher DISCORD_TOKEN
bun run build                             # build do painel (servido pelo bot)
bun start
```

Semear configuracao a partir de JSON:

```bash
cd apps/bot && bun scripts/seed.ts seed.json data/bot.db
```

## Personalidade

`apps/bot/personality.md` e obrigatorio: e o prompt base do bot (sem ele o bot nao sobe).
E relido a cada sessao nova, entao editar vale sem restart. As souls do painel entram
como complemento por canal. O bot nao carrega `AGENTS.md`, skills nem extensions do pi.

## Ambiente

Arquivo `apps/bot/.env`:

| Variavel | Descricao |
|---|---|
| `DISCORD_TOKEN` | Obrigatorio. Token do bot. |
| `AGENT_MODEL` | Modelo da conversa, `provider/id` do pi (ex.: `openai-codex/gpt-6-luna`). Vazio = padrao do pi. Vale ao reiniciar. |
| `CHAT_API_KEY` ou `OPENCODE_API_KEY` | Chave do modelo usado na consolidacao de memoria (o modelo e o campo do painel). |
| `DASHBOARD_PASSWORD` | Senha do painel. |
| `DASHBOARD_PORT` | Porta do painel (padrao 8080; 0 desliga). |
| `DASHBOARD_HOST` | Host do painel (padrao `127.0.0.1`). |
| `BOT_DB` | Caminho do SQLite (padrao `apps/bot/data/bot.db`). |
| `YTDLP_BIN` | Caminho do binario do yt-dlp. |
| `AGENT_ALLOW_PRIVATE` | `1` libera hosts privados nas ferramentas web (so para teste local). |

## Desenvolvimento

```bash
bun run check               # tsc --noEmit em todos os pacotes
bun run test                # testes de todos os pacotes
bun run dev                 # painel em modo dev (vite, proxy /api para :8080)
```

Todos os testes usam `bun:test`.

Atualizar o pi: subir `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` juntos
para a mesma versao em `apps/bot/package.json`, `bun install`, `bun run check && bun run test`.

## Licenca

MIT
