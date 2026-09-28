# Plano: memoria mais robusta

Objetivo: o bot aprender com o grupo aos poucos, no estilo do Hermes Agent, sem quebrar a arquitetura hexagonal nem o TDD do `AGENTS.md`.

Hoje o bot ja tem o equivalente da revisao em background do Hermes (consolidacao a cada 90s) e da busca em sessoes antigas (`search_history`). O que falta: curadoria do que ja foi aprendido, saber quem esta falando e aprender na hora.

## Andamento

- Fase 0: feita.
- Fase 1: feita. Diferencas do plano: o cabecalho do turno nao tem hora (o dominio nao conhece fuso); `ChatRequest` nao mudou, o texto do turno ja chega pronto; no painel quem fala aparece como "painel".
- Fases 2 a 5: pendentes.

## O que vale copiar do Hermes

- **Memoria curta e com limite, sempre no prompt:** `MEMORY.md` (~2200 chars) e `USER.md` (~1375 chars). Quando enche, o agente junta ou apaga entradas em vez de acumular.
- **Tool `memory` (add/replace/remove):** o agente grava durante a conversa. Alem disso, ha uma revisao periodica em background.
- **Busca FTS5 nas sessoes antigas:** cobre o que nao virou memoria.
- **Controle do que entra:** as escritas podem passar por aprovacao e sao checadas contra injecao, porque a memoria vai para o prompt.

Diferenca proposital: o Hermes congela a memoria no prompt da sessao para aproveitar cache. Aqui a sessao e dividida por varios amigos no mesmo canal, entao o que e de cada pessoa vai na mensagem dela (fase 1).

## Diagnostico

1. **O modelo nao sabe quem esta falando.** A sessao e por canal+papel e recebe so `m.content` (`src/adapters/out/pi-agent/pi-chat-agent.ts:115`).
   - Exemplo: a Ana pergunta "qual meu jogo favorito?" e o Bruno pergunta "e o meu?". Para o modelo, e uma pessoa so.
2. **As memorias pessoais ficam presas a quem abriu a sessao.** O prompt com as memorias "[sua]" so e aplicado quando a sessao e criada (`src/adapters/out/pi-agent/session-pool.ts:83`, `src/application/reply-to-message.ts:106`).
   - Exemplo: a Ana abre a sessao e, 10 min depois, o Bruno fala. O modelo le as preferencias da Ana como se fossem do Bruno.
   - Enquanto chamarem o bot com menos de 30 min de intervalo, a sessao nao morre e memoria nova nao entra.
3. **O extrator nao ve o que ja sabe.** O prompt pede "reutilize a mesma key", mas nao mostra as keys existentes (`src/domain/memory.ts:101`, `src/application/consolidate-memory.ts:41`).
   - Resultado: `jogo-favorito` e `jogo-preferido-ana` ficam ativas juntas.
   - "Parei de jogar LoL" nao apaga nada, porque so existe upsert.
4. **O bot aprende com as proprias falas.** As mensagens do bot entram no lote como as de qualquer autor.
   - Exemplo: o bot inventa "o Bruno e corintiano" e isso vira fato do grupo.
   - O proprio bot pode ate ganhar uma memoria `user` (`src/domain/memory.ts:75`).
5. **A busca quase sempre volta vazia.** A query junta todos os termos com AND (`src/adapters/out/sqlite/memory-store.ts:103`).
   - "qual o jogo favorito da ana" exige que "qual", "o" e "da" estejam no texto.
   - "favoritos" nao acha "favorito".
   - Memoria `user` de outro canal nao aparece na busca, mas aparece no prompt.
6. **As versoes se misturam.** O historico e ligado so pela `memory_key` (`src/adapters/out/sqlite/memory-store.ts:126` e `:180`).
   - O `jogo-favorito` da Ana e o do Bruno dividem historico e contagem no painel.
7. **Dados jogados fora.**
   - O `summary` de cada lote e descartado.
   - `episodes` sao gravados mas nunca lidos. A key deles e global, entao um canal sobrescreve o outro (`src/adapters/out/sqlite/memory-store.ts:52`).
8. **A escolha do que vai no prompt e simplista.**
   - Entram as 10 ultimas por `rowid`, que e a ordem de criacao. Memoria atualizada nao sobe (`src/adapters/out/sqlite/memory-store.ts:78`).
   - `fact` nunca entra.
   - O texto e cortado em 1500 chars no meio da linha (`src/domain/memory.ts:130`).
9. **Nao da para ensinar na hora.** "Lembra que eu odeio spoiler" depende do lote e do julgamento do extrator, sem confirmacao. Esquecer so e possivel pelo painel.

## Fases

Cada fase pode ir para o servidor sozinha e segue o ciclo red/green. Quando mexer em porta com estado, tem suite de contrato rodando contra o fake e contra o adapter real. Toda fase fecha com `bun run check` e `bun test` verdes.

Ordem recomendada: 0, 1, 2, 3, 4, 5. A fase 3 depende da 1 (autor do turno) e reaproveita as operacoes da 2.

### Fase 0: bugs que estragam a memoria atual

Tamanho: pequena. Resolve os problemas 4, 5 e 6.

1. **Versoes por id.**
   - Migracao v5: coluna `memory_versions.memory_id`, preenchida a partir de (key, scope, person_id, channel_id).
   - `versions` e `record` passam a filtrar por id.
2. **Falas do bot marcadas.**
   - `NewMessage.fromBot` (o gateway ja sabe `m.author.bot`) e coluna `messages.from_bot` na v5.
   - `extractionPrompt` marca essas linhas como `[bot]` e diz que fala do bot nunca vira fato; so a correcao que os outros fazem a ela.
   - `validateExtraction` descarta memoria `user` cujo autor e o bot.
3. **Busca tolerante.**
   - Funcao pura `searchTerms` em `domain/`: normaliza e tira stopwords em PT e tokens curtos.
   - O adapter monta `"t1"* OR "t2"*` com `ORDER BY rank`, tanto para `memories_fts` quanto para `messages_fts`. O fake usa a mesma funcao.
   - Memoria `user` passa a ser buscavel em qualquer canal, igual ao `familiar`.

Testes (red primeiro):

- Contrato: `it("versoes de pessoas diferentes com a mesma chave nao se misturam")`
- Dominio: `it("fala do bot aparece marcada no prompt")`
- Dominio: `it("descarta memoria de usuario atribuida ao bot")`
- Contrato: `it("acha memoria por pergunta em linguagem natural")`
- Contrato: `it("acha plural pelo prefixo")`

### Fase 1: saber quem esta falando

Tamanho: media. Resolve os problemas 1 e 2.

- **Prompt da sessao:** soul + memoria do grupo. E estavel e aproveita cache.
- **Cada mensagem enviada ao modelo** ganha um cabecalho montado na `application`:

  ```
  [Ana (id 123) - 21:04]
  [o que voce lembra da Ana]
  - odeia spoiler de serie
  - joga Terraria com o Bruno toda sexta
  [conversa no canal desde sua ultima fala]
  Bruno: alguem viu o trailer?
  Ana: vi, ficou bom
  ---
  @bot o que vc achou?
  ```

- **Mudancas no codigo:**
  - `Persona` passa a ter `systemPromptFor(channelId)` e `turnPreamble(...)`.
  - `IncomingMessage` e `ChatRequest` ganham `authorName` e `messageId`.
  - O gateway usa o nome de exibicao no servidor (tambem no historico) e `m.cleanContent`, para mencoes virarem @nome em vez de `<@123>`.
- **Conversa desde a ultima fala do bot:**
  - Novo metodo `MessageStore.sinceLastBotMessage`, que usa `from_bot` da fase 0.
  - Limite de ~15 mensagens ou 2000 chars, sem a propria mensagem que disparou.
  - Resolve o "o que voces acham disso?" que hoje o bot nao entende.
- **Idade maxima da sessao:** o `SessionPool` passa a recriar a sessao depois de, por exemplo, 3h, mesmo em uso, para a memoria do grupo atualizar.

Testes:

- `it("cada turno diz quem esta falando")`
- `it("memorias da pessoa vao no turno dela, nao no de quem abriu a sessao")`
- `it("inclui a conversa do canal desde a ultima resposta do bot")`
- `it("recria a sessao depois da idade maxima mesmo em uso")` (relogio injetado)

### Fase 2: consolidacao que revisa, nao so acumula

Tamanho: grande. Resolve os problemas 3, 7 e 8. Equivale a revisao periodica do Hermes.

- **Entrada e saida do extrator:**
  - Recebe as memorias atuais relevantes, com limite e key: as `user` de quem falou no lote e as `group` do canal.
  - Devolve operacoes:

    ```json
    {
      "summary": "...",
      "ops": [{ "op": "add|update|forget|confirm", "key": "...", "kind": "...", "scope": "...", "person_id": "...", "content": "...", "reason": "..." }],
      "episodes": []
    }
    ```

- **Regras no dominio:**
  - Tipo `MemoryOp` e `validateOps(raw, conhecidas, autores)`.
  - `update`, `forget` e `confirm` so valem para key conhecida.
  - A regra atual de escopo continua: memoria `user` so sobre o proprio autor, o que evita trollagem.
- **Semantica das operacoes:**
  - `forget` marca como `suppressed` com motivo, reversivel no painel.
  - `confirm` sobe `seen_count` e `last_seen_at` sem criar versao.
- **Migracao v6:**
  - Colunas `memories.seen_count`, `memories.last_seen_at` e `memories.source` (consolidacao, tool:<autor> ou painel).
  - Memoria `user` vira global (`channel_id = ''`), juntando duplicatas pela mais nova.
  - `episodes` ganha `channel_id` e unicidade por (key, channel_id). A tabela nunca foi lida, pode ser recriada.
  - O `summary` do lote passa a ser gravado em `rolling_summaries` (ja existe, vazia), na mesma transacao do cursor.
- **Ordem do que vai no prompt (no dominio):**
  - Prioridade por kind, depois `seen_count`, depois atualizacao recente.
  - Limite de chars cortando em linha inteira.
  - `fact` entra se sobrar espaco.
- **Busca:** `memory_search` passa a buscar tambem os episodios.
- **Calibragem do prompt:** fora do `bun test`, um `scripts/memory-eval.ts` com 5 a 10 conversas-gabarito rodando no modelo real. Um fake nao mede a qualidade do prompt.

Testes:

- `it("passa ao extrator as memorias atuais dos autores do lote")`
- `it("update em chave desconhecida e descartado")`
- `it("forget suprime com o motivo e vira versao")`
- `it("confirmar fato sobe o ranking sem criar versao")`
- `it("limite do prompt corta em linha inteira")`

### Fase 3: ensinar na hora

Tamanho: media. Resolve o problema 9. Equivale a tool `memory` do Hermes.

- **Caso de uso e tools:**
  - Caso de uso `LearnNow`, com as mesmas `MemoryOp` da fase 2.
  - Tools `memory_save` (content, kind, sobre: eu ou grupo) e `memory_forget` (texto ou key) em `adapters/in/pi-tools`.
- **De onde vem o autor:**
  - Sempre do turno, nunca de um parametro que o modelo passa.
  - Um registro `CurrentSpeaker` por canal, na `application`, guarda quem esta falando e e preenchido pelo `ReplyToMessage` antes do `ask`.
  - E seguro porque a fila roda uma resposta por vez em cada canal.
- **Comandos no Discord (`TextCommands`):**
  - `!memoria`: mostra o que o bot sabe de mim, com as keys.
  - `!esquece <texto>`: apaga as proprias memorias. Memoria do grupo pode ser suprimida, com autor e motivo registrados.
- **Anti-trollagem:** amigo vai tentar plantar coisa ("lembra que o Bruno deve 50 reais"). Memoria `user` so sobre si mesmo; memoria `group` com autor em `source`, visivel no painel e reversivel.
- **Quando aparece:** a memoria salva ja aparece na mensagem seguinte, pelo cabecalho da fase 1. No Hermes, so aparece na proxima sessao.

Testes:

- `it("memory_save grava sobre quem esta falando, nao sobre o id que o modelo passou")`
- `it("memoria salva aparece no turno seguinte")`
- `it("!esquece nao apaga memoria de outra pessoa")`

### Fase 4: perfil de cada amigo e do grupo

Tamanho: media. E o `USER.md` do Hermes, um por pessoa.

- Porta `ProfileStore`, com suite de contrato, adapter sqlite e fake. Tabela `profiles (subject, channel_id, body, updated_at)`.
- Caso de uso `RefreshProfiles`: roda depois da consolidacao, so para quem teve memoria alterada.
- O modelo (mesmo `LearningExtractor`) resume as memorias ativas e o nome num cartao de ~600 chars por pessoa e ~1500 para o grupo.
- O cartao substitui a lista crua no cabecalho de cada mensagem (pessoa) e no prompt da sessao (grupo). Sem cartao, vale a ordem da fase 2.
- Painel: aba Pessoas com os cartoes (opcional).

Testes:

- `it("so regenera perfil de quem teve memoria alterada")`
- `it("perfil acima do limite e cortado em linha inteira")`
- `it("sem perfil usa o ranking de memorias")`

### Fase 5: feedback e limpeza (opcional)

Tamanho: media.

- Reacoes nas mensagens do bot (intent `GuildMessageReactions`) e respostas como "errado" vao para `interaction_events`, tabela que ja existe e esta vazia. A consolidacao le esses eventos junto do lote e tira `lesson`, como o gatilho "correcao do usuario" do Hermes.
- Limpeza semanal: pessoa com mais de ~40 memorias ativas passa por uma juncao de duplicatas, com as mesmas `MemoryOp`.

## Adiado de proposito

- **Embeddings/sqlite-vec:** a coluna `memories.embedding` ja esta reservada. Com a busca da fase 0 e os cartoes, deve bastar para um servidor de amigos. Rever se a busca continuar errando.
- **Skills do Hermes:** servem para procedimentos, que um bot de conversa quase nao usa. As `lesson` cobrem esse papel.

## Decisoes em aberto

1. **Memoria de pessoa vale em todos os canais?** Recomendacao: sim. O prompt ja faz isso, so a busca diverge.
2. **Quem pode esquecer memoria do grupo?** Recomendacao: qualquer amigo, com autor e motivo registrados e possibilidade de desfazer no painel.
3. **Custo da fase 4:** cerca de 1 chamada ao modelo por pessoa com memoria nova em cada ciclo de consolidacao.

## Fontes

- [Persistent Memory - Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
- [Inside Hermes Agent: How a Self-Improving AI Agent Actually Works](https://mranand.substack.com/p/inside-hermes-agent-how-a-self-improving)
- [NousResearch/hermes-agent (GitHub)](https://github.com/nousresearch/hermes-agent)
