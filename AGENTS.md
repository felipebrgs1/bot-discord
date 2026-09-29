# elmatadore-bot

Bot de Discord sobre o SDK do pi (`@earendil-works/pi-coding-agent`). Arquitetura hexagonal, TDD obrigatorio.

## Monorepo

Workspaces do Bun orquestrados pelo Turborepo.

```
apps/
  bot/        o bot (hexagonal, abaixo). Caminhos `src/...` deste arquivo sao relativos a apps/bot.
  web/        painel React (Vite) + worker.ts (Cloudflare: login e proxy de /api)
packages/
  api/        contrato HTTP do painel: so tipos, importados pelo bot, pelo worker e pelo front
  tsconfig/   base estrita compartilhada (base.json)
```

- Mudou uma rota ou resposta do painel: muda primeiro `packages/api`, depois servidor (`apps/bot/src/adapters/in/http-panel`) e front. O `check` pega o lado que ficou para tras.
- Nenhum app importa outro app. Codigo compartilhado vira pacote em `packages/`.
- Do ponto de vista do bot, `@elmatadore/api` e um pacote externo: so `adapters` importam.

### Painel (apps/web)

```
src/
  lib/        logica pura com teste: cliente da API (fetch injetado), SSE, filtros, formatacao, nav
  app/        App, login, contexto da API
  features/   uma pasta por tela: chat, memory, logs, metrics, config
  components/ ui/ (shadcn), shell/ (trilho, cabecalho, barra de status) e primitivas
  hooks/      polling, hash, atalhos
```

- Regra de tela nasce em `lib/` com teste (`bun:test`, sem DOM). Componente so liga estado e `lib`.
- O cliente recebe `fetch` por parametro; teste usa fetch falso escrito a mao. Proibido stub de `globalThis.fetch`.
- Cor so por token de `index.css` (tema escuro e o padrao); nada de hex em componente.

## Estilo

- Respostas curtas e diretas. Sem emojis em codigo, commits ou docs.
- Pergunta do usuario: responder antes de editar.
- Feedback do usuario: dizer se concorda ou discorda antes de mudar algo.
- Design ou bug nao trivial: problema, exemplo concreto, solucao.
- Identificadores em ingles. Comentarios, docs e commits em portugues.

## TDD (obrigatorio)

Todo codigo de producao nasce de um teste que falhou antes.

1. **Red:** escrever o teste do comportamento. Rodar e ver falhar pelo motivo certo (nao por erro de import ou de digitacao).
2. **Green:** o minimo de codigo para passar.
3. **Refactor:** limpar com os testes verdes. Rodar de novo.

Regras:

- Bug: primeiro um teste que reproduz o bug e falha; depois o fix.
- Nao existe "teste depois". Se o codigo foi escrito sem teste, apagar e refazer pelo ciclo.
- Mudanca so de refactor nao muda testes de comportamento. Se precisou mudar, era mudanca de comportamento.
- Teste descreve comportamento, nao implementacao. Nomes em frases: `it("ignora mensagens de bots")`.
- Testes usam `bun:test`. Proibido `mock.module`/`vi.mock` e stub de global (inclusive `globalThis.fetch`): dependencias entram por porta e sao trocadas por fakes escritos a mao.
- Testes nao usam rede, Discord real, LLM real nem o relogio real. Tempo entra pela porta `Clock`.
- Ao final de cada tarefa: `bun run check` e `bun run test` na raiz verdes (todos os pacotes), saida completa, sem warnings.

Onde testar cada camada:

| Camada | Tipo de teste | Dependencias no teste |
|---|---|---|
| `domain` | unitario puro | nenhuma |
| `application` | unitario do caso de uso | fakes das portas (`src/test-support/fakes/`) |
| `adapters/out` | contrato da porta + integracao | SQLite `:memory:`, servidor `node:http` local, fixtures em disco |
| `adapters/in` | traducao entrada -> caso de uso | objetos simples no formato do Discord/HTTP + casos de uso com fakes |
| `main` | smoke de montagem | fakes onde houver rede |

**Teste de contrato:** porta de saida com estado (stores, outbox, fetcher) tem uma suite em `src/application/ports/<porta>.contract.ts` que recebe uma fabrica. A mesma suite roda contra o fake e contra o adapter real. Assim o fake nao mente.

**Adapter de rede:** nunca rede real. O adapter recebe `fetch` injetado (`HttpPageFetcher`, `ChatJsonExtractor`) ou a porta `PageFetcher` (`NewsWikiSearch`, `SkidrowCatalog`), e o teste usa `FakePageFetcher` com rotas por regex. Processo externo (yt-dlp) e testado com binario falso em pasta temporaria.

```ts
// src/application/ports/memory-store.contract.ts
export function memoryStoreContract(make: () => MemoryStore) {
  it("busca so no escopo do canal", async () => { ... });
}
// src/adapters/out/sqlite/memory-store.test.ts
memoryStoreContract(() => new SqliteMemoryStore(openDatabase(":memory:")));
// src/test-support/fakes/memory-store.test.ts
memoryStoreContract(() => new FakeMemoryStore());
```

## Arquitetura hexagonal

Problema que resolve: com Discord, painel, tools do agente e agendador chamando as mesmas regras, cada entrada nova duplicaria regra e cada teste precisaria simular a tecnologia inteira. Solucao: regras no centro, tecnologia na borda, ligadas por interfaces (portas).

```
src/
  domain/          regras puras: settings, roles, trigger, cooldown, reply-split,
                   memory (validacao/prompt/familiaridade), soul, game, media-policy,
                   html-text, http-url, image, message, turn
  application/
    ports/         interfaces das portas de saida + suites de contrato
    *.ts           casos de uso: ReplyToMessage, TextCommands, Persona, MessageLog,
                   ConsolidateMemory, Recall, WebResearch, SearchGames, DownloadMedia,
                   DownloadImages, OutboxDelivery, WebChat, Panel
  adapters/
    in/            discord (gateway, anexos, /lista, ReplyTarget), http-panel,
                   pi-tools (tools do agente), scheduler (consolidacao)
    out/           sqlite, pi-agent, web (fetcher, guarda SSRF, busca, Skidrow),
                   llm (extrator), ytdlp, fs (outbox), log, clock
  main/            compose.ts (composition root) e run.ts (le .env e sobe)
  test-support/    fakes das portas + teste de arquitetura
```

### Regra de dependencia

As setas de import so apontam para dentro:

```
main -> adapters -> application -> domain
```

- Todo arquivo de `src/` esta numa dessas camadas (ou em `test-support`).
- `domain` nao importa nada fora de `domain`. Sem `node:*`, sem npm.
- `application` importa so `domain` e `application`. Sem `node:*`, sem `discord.js`, sem `@earendil-works/*`, sem `node:sqlite`.
- `adapters` importam `application` e `domain`, nunca outro adapter (nem nos testes). Codigo compartilhado entre adapters vai para `application` (se for regra) ou para um modulo do proprio adapter.
- So `main` conhece todos os adapters e le o ambiente (`process.env`, `.env`).
- Tipos do pi, do discord.js e do SQLite nao atravessam a borda. O adapter traduz para tipos do dominio.

`src/test-support/architecture.test.ts` verifica essas regras lendo os imports. Se ele falha, a correcao e mover codigo, nunca afrouxar o teste.

### Portas

- **Porta de entrada:** o caso de uso em si (classe em `application/`). Adapters de entrada so traduzem e chamam.
- **Porta de saida:** interface em `application/ports/`, nomeada pela capacidade, nao pela tecnologia: `MemoryStore`, nao `SqliteMemory`.
- Uma porta por capacidade, pequena. Leitura do painel e escrita da consolidacao sao portas separadas (`MemoryAdmin`, `MemoryStore`), mesmo com um adapter implementando as duas.
- O pi e um adapter como outro qualquer: `adapters/out/pi-agent` implementa `ChatAgent` e `ChatSessions`; `adapters/in/pi-tools` expoe casos de uso como tools do agente (`defineTool`).

Portas de saida: `ChatAgent`, `ChatSessions`, `Clock`, `ConfigStore`, `GameCatalog`, `HistorySearch`, `HostGuard`, `LearningExtractor`, `LogFeed`, `Logger`, `MediaDownloader`, `MemoryAdmin`, `MemoryStore`, `MessageStore`, `MetricsQuery`, `MetricsSink`, `Outbox`, `PageFetcher`, `SoulStore`, `WebSearch`.

### Nova porta ou adapter (roteiro)

1. Teste do caso de uso com fake da porta (red).
2. Interface da porta em `application/ports/` + fake em `test-support/fakes/`.
3. Caso de uso (green).
4. Suite de contrato da porta; rodar contra o fake.
5. Adapter real; rodar a mesma suite de contrato contra ele.
6. Ligar em `main/compose.ts` e cobrir no teste de montagem (`main/compose.test.ts`).

## Codigo

- TypeScript estrito. Sem `any`; se for inevitavel, comentar o motivo.
- Imports so no topo. Sem `await import()` nem `import("pkg").Type`.
- So sintaxe apagavel (`erasableSyntaxOnly`): sem `enum`, `namespace`, parameter properties. Campos explicitos + atribuicao no construtor.
- `tsconfig.json` e estrito (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noUnused*`...). Nao afrouxar flag para passar no check.
- APIs do Bun (`Bun.*`, `bun:sqlite`) so em `adapters` e `main`.
- Ambiente (`process.env`, `.env`) so em `main`; o resto recebe valores por construtor.
- Helper de uma linha com um so uso: inline.
- Tipos de libs externas: conferir em `node_modules`, nao adivinhar.
- Perguntar antes de remover funcionalidade que parece intencional.
- Sem compatibilidade retroativa, a menos que pedida.

## Comandos

Runtime, gerenciador de pacotes e test runner: Bun. O Bun roda o `.ts` direto, sem build.

Na raiz (turbo roda em todos os pacotes):

```bash
bun install
bun run check                      # tsc --noEmit em cada pacote (TypeScript 7)
bun run test                       # bun test em cada pacote
bun run build                      # build do painel (apps/web/dist)
bun run dev                        # painel em modo dev (vite, proxy /api -> :8080)
bun start                          # sobe o bot (apps/bot)
```

Dentro de um pacote:

```bash
cd apps/bot && bun test src/caminho.test.ts
cd apps/bot && bun test -t "nome do teste"
cd apps/web && bun test
```

- Script ad-hoc: arquivo temporario, rodar, apagar.

## Dependencias

- Versoes exatas. `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` sempre na mesma versao.
- Mudanca de dependencia ou lockfile e codigo revisado: dizer o que mudou e por que.
- Atualizar o pi: subir as duas versoes em `apps/bot/package.json`, `bun install`, `bun run check && bun run test`, ler o CHANGELOG do pi no intervalo.
- O Bun nao roda scripts de lifecycle de dependencias fora de `trustedDependencies`. Adicionar la so com revisao.

## Git

- Commit so quando o usuario pedir.
- Stage por caminho explicito. Nunca `git add -A`, `git reset --hard`, `git push --force`, `--no-verify`.
- Mensagem: `tipo(escopo): descricao`, tipos `feat|fix|refactor|test|docs|chore`. Ex.: `refactor(memory): extrai porta MemoryStore`.
- Segredos (`.env`, tokens) e `data/` nunca entram no git (ficam em `apps/bot/`).
