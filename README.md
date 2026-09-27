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

## Uso

```bash
bun install
cp .env.example .env    # preencher DISCORD_TOKEN
bun start               # bun src/main/run.ts
```

Semear configuracao a partir de JSON:

```bash
bun scripts/seed.ts seed.json data/bot.db
```

## Ambiente

Arquivo `.env` na raiz:

| Variavel | Descricao |
|---|---|
| `DISCORD_TOKEN` | Obrigatorio. Token do bot. |
| `CHAT_API_KEY` ou `OPENCODE_API_KEY` | Chave do modelo usado na consolidacao de memoria. |
| `DASHBOARD_PASSWORD` | Senha do painel. |
| `DASHBOARD_PORT` | Porta do painel (padrao 8080; 0 desliga). |
| `DASHBOARD_HOST` | Host do painel (padrao `127.0.0.1`). |
| `BOT_DB` | Caminho do SQLite (padrao `data/bot.db`). |
| `YTDLP_BIN` | Caminho do binario do yt-dlp. |
| `AGENT_ALLOW_PRIVATE` | `1` libera hosts privados nas ferramentas web (so para teste local). |

## Desenvolvimento

```bash
bun run check               # tsc --noEmit
bun test                    # testes do bot (src/)
bun run --cwd web test      # testes do painel
bun run --cwd web dev       # painel em modo dev (vite)
```

Todos os testes usam `bun:test`.

Atualizar o pi: subir `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` juntos
para a mesma versao, `bun install`, `bun run check && bun test`.

## Licenca

MIT
