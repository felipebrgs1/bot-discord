# elmatadore-bot

Bot de Discord sobre o SDK do pi (`@earendil-works/pi-coding-agent`). Arquitetura hexagonal, TDD obrigatorio.

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
- Testes usam `bun:test`. Proibido `mock.module`/`vi.mock` e stub de global: dependencias entram por porta e sao trocadas por fakes escritos a mao. (`src/test-support/stub-fetch.ts` e provisorio, so para o codigo legado.)
- Testes nao usam rede, Discord real, LLM real nem o relogio real. Tempo entra pela porta `Clock`.
- Ao final de cada tarefa: `bun run check` e `bun test` verdes, saida completa, sem warnings.

Onde testar cada camada:

| Camada | Tipo de teste | Dependencias no teste |
|---|---|---|
| `domain` | unitario puro | nenhuma |
| `application` | unitario do caso de uso | fakes das portas (`src/test-support/fakes/`) |
| `adapters/out` | contrato da porta + integracao | SQLite `:memory:`, servidor `node:http` local, fixtures em disco |
| `adapters/in` | traducao entrada -> caso de uso | objetos simples no formato do Discord/HTTP + casos de uso com fakes |
| `main` | smoke de montagem | fakes onde houver rede |

**Teste de contrato:** cada porta de saida tem uma suite em `src/application/ports/<porta>.contract.ts` que recebe uma fabrica. A mesma suite roda contra o fake e contra o adapter real. Assim o fake nao mente.

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

Problema: hoje `gateway.ts` mistura discord.js, regra de gatilho, fila, cooldown e envio. Para testar uma regra ("responde so se for mencionado") e preciso simular o Discord inteiro. Cada porta nova (Telegram, painel, CLI, agendador) duplicaria a regra.

Solucao: regras no centro, tecnologia na borda, ligadas por interfaces (portas).

```
src/
  domain/          regras puras: entidades, politicas, calculos
  application/
    ports/         interfaces das portas de saida + suites de contrato
    <caso-de-uso>.ts
  adapters/
    in/            quem chama o bot: discord, http-panel, scheduler, pi-tools
    out/           o que o bot chama: sqlite, pi-agent, web, ytdlp, fs, clock, log
  main/            composition root: le env, instancia adapters, injeta, sobe
  test-support/    fakes das portas e builders de dados de teste
```

### Regra de dependencia

As setas de import so apontam para dentro:

```
main -> adapters -> application -> domain
```

- `domain` nao importa nada fora de `domain`. Sem `node:*`, sem npm.
- `application` importa so `domain` e `application`. Sem `node:*`, sem `discord.js`, sem `@earendil-works/*`, sem `node:sqlite`.
- `adapters` importam `application` e `domain`, nunca outro adapter. Codigo compartilhado entre adapters vai para `application` (se for regra) ou para um modulo do proprio adapter.
- So `main` conhece todos os adapters e le `process.env`.
- Tipos do pi, do discord.js e do SQLite nao atravessam a borda. O adapter traduz para tipos do dominio.

`src/architecture.test.ts` verifica essas regras lendo os imports. Se ele falha, a correcao e mover codigo, nunca afrouxar o teste.

### Portas

- **Porta de entrada:** o caso de uso em si (funcao ou classe em `application/`). Adapters de entrada so traduzem e chamam.
- **Porta de saida:** interface em `application/ports/`, nomeada pela capacidade, nao pela tecnologia: `MemoryStore`, nao `SqliteMemory`.
- Uma porta por capacidade, pequena. Se um caso de uso so precisa ler, a porta so tem leitura.
- O pi e um adapter como outro qualquer: `adapters/out/pi-agent` implementa `ChatAgent`; `adapters/in/pi-tools` expoe casos de uso como tools do agente (`defineTool`).

Portas de saida previstas: `ChatAgent`, `MessageStore`, `MemoryStore`, `ConfigStore`, `SoulStore`, `MetricsSink`, `LearningExtractor`, `WebSearch`, `PageFetcher`, `MediaDownloader`, `GameCatalog`, `Outbox`, `Clock`, `Logger`.

### Nova porta ou adapter (roteiro)

1. Teste do caso de uso com fake da porta (red).
2. Interface da porta em `application/ports/` + fake em `test-support/fakes/`.
3. Caso de uso (green).
4. Suite de contrato da porta; rodar contra o fake.
5. Adapter real; rodar a mesma suite de contrato contra ele.
6. Ligar em `main/`.

## Migracao do codigo atual

O codigo em `src/*.ts`, `src/memory/` e `src/tools/` ainda e pre-hexagonal. Regras:

- Codigo novo ja nasce na estrutura nova.
- Ao mexer num modulo antigo, migrar a parte tocada: primeiro testes de caracterizacao (fixam o comportamento atual), depois mover.
- Um modulo por commit. Os testes existentes tem que continuar verdes durante a migracao.

Destino previsto:

| Atual | Destino |
|---|---|
| `split.ts` | `domain/reply-split.ts` |
| `roles.ts` | `domain/roles.ts` (politica) |
| `gateway.ts` | `domain` (gatilho, cooldown) + `application/handle-message.ts` + `adapters/in/discord/` |
| `vision.ts` | `adapters/in/discord/attachments.ts` |
| `sessions.ts` | `adapters/out/pi-agent/` (implementa `ChatAgent`) |
| `tools/*.ts` | `adapters/in/pi-tools/` + casos de uso + `adapters/out/{web,ytdlp,skidrow}` |
| `tools/net.ts` | `adapters/out/web/` (`PageFetcher`, guarda SSRF) |
| `db.ts` | `adapters/out/sqlite/db.ts` (conexao + migrations) |
| `config.ts` | `domain/config.ts` (defaults) + porta `ConfigStore` + `adapters/out/sqlite/` |
| `souls.ts`, `metrics.ts` | porta + caso de uso + `adapters/out/sqlite/` |
| `memory/consolidate.ts` | `application/consolidate-memory.ts` + `adapters/in/scheduler/` |
| `memory/extract.ts` | `adapters/out/llm-extractor/` (`LearningExtractor`) |
| `memory/familiarity.ts` | `application/` + `MemoryStore` |
| `outbox.ts` | `adapters/out/fs/outbox.ts` |
| `weblog.ts` | `adapters/out/log/` (`Logger`) |
| `webapi.ts` | `adapters/in/http-panel/` |
| `start.ts`, `run.ts` | `main/` |

## Codigo

- TypeScript estrito. Sem `any`; se for inevitavel, comentar o motivo.
- Imports so no topo. Sem `await import()` nem `import("pkg").Type`.
- So sintaxe apagavel (`erasableSyntaxOnly`): sem `enum`, `namespace`, parameter properties. Campos explicitos + atribuicao no construtor.
- `tsconfig.json` e estrito (`noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`, `noUnused*`...). Nao afrouxar flag para passar no check.
- APIs do Bun (`Bun.*`, `bun:sqlite`) so em `adapters` e `main`.
- Helper de uma linha com um so uso: inline.
- Tipos de libs externas: conferir em `node_modules`, nao adivinhar.
- Perguntar antes de remover funcionalidade que parece intencional.
- Sem compatibilidade retroativa, a menos que pedida.

## Comandos

Runtime, gerenciador de pacotes e test runner: Bun. O Bun roda o `.ts` direto, sem build.

```bash
bun install
bun run check                      # tsc --noEmit (TypeScript 7)
bun test                           # src/ (bunfig.toml)
bun test src/caminho.test.ts
bun test -t "nome do teste"
bun run --cwd web test             # painel: vitest
bun start                          # bun src/run.ts
```

- Script ad-hoc: arquivo temporario, rodar, apagar.

## Dependencias

- Versoes exatas. `@earendil-works/pi-ai` e `@earendil-works/pi-coding-agent` sempre na mesma versao.
- Mudanca de dependencia ou lockfile e codigo revisado: dizer o que mudou e por que.
- Atualizar o pi: subir as duas versoes, `bun install`, `bun run check && bun test`, ler o CHANGELOG do pi no intervalo.
- O Bun nao roda scripts de lifecycle de dependencias fora de `trustedDependencies`. Adicionar la so com revisao.

## Git

- Commit so quando o usuario pedir.
- Stage por caminho explicito. Nunca `git add -A`, `git reset --hard`, `git push --force`, `--no-verify`.
- Mensagem: `tipo(escopo): descricao`, tipos `feat|fix|refactor|test|docs|chore`. Ex.: `refactor(memory): extrai porta MemoryStore`.
- Segredos (`.env`, tokens) e `data/` nunca entram no git.
