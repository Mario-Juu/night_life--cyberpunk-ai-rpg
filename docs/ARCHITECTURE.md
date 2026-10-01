# NIGHT//LIFE — Arquitetura

> O LLM é o Mestre e Narrador, mas **não** é a fonte de verdade.
> REGRAS = motor · ESTADO = GameState · DADOS = dice engine · HISTÓRICO = event log · MEMÓRIA = memory system · NARRATIVA = LLM

## 1. Fluxo de um turno

```
JOGADOR (texto livre)
  │
  ▼
INTÉRPRETE (LLM, /api/gm/interpret)
  └─ devolve intenção + chamadas de ferramentas (ex.: attack{targetName, weaponId})
  │
  ▼
MOTOR (shared/engine, roda no cliente)
  ├─ registro de ferramentas: valida nome, origem e argumentos (zod gerado do ParamSpec)
  ├─ regras: arma, munição, alvo vivo, alcance, saldo, relação e dificuldade dinâmica
  ├─ rolagem (se houver): 1d10 com seed registrada → RollRecord e CheckRecord
  └─ efeitos no GameState + eventos estruturados
  │
  ▼
SNAPSHOT post_engine (IndexedDB) ── permite regenerar a narração
  │
  ▼
CONTEXTO (shared/engine/context.ts): personagem, cena, NPCs relevantes, missões,
          mundo/flags, memórias por relevância, resumos e histórico recente
  │
  ▼
NARRADOR (LLM, /api/gm/narrate)
  ├─ recebe o RESULTADO DO MOTOR como verdade absoluta
  ├─ o verificador de consistência reprova contradições e pede reescrita (1 tentativa)
  └─ devolve narração + ferramentas de consequência + enemyActions
  │
  ▼
MOTOR de novo: valida as ferramentas do narrador e resolve os ataques inimigos
  │
  ▼
FINALIZAÇÃO: memórias automáticas, poda, TurnRecord salvo, versão do estado, resumo de longo prazo
  │
  ▼
INTERFACE
```

Uma única fila (`turnController.exclusive`) serializa as operações com o Mestre: narrativa, telefone e resumo.
Todo estado muda por funções puras do motor e depois por `commit()`, que incrementa `session.version`
e aceita `expectedVersion` (concorrência otimista).

## 2. Onde está cada coisa

| Conceito | Arquivo |
|---|---|
| GameState (session, character, world, scene, npcs, missions, factions, flags, activeEffects, scheduled, history…) | `shared/types/game.ts` |
| Turn, ToolCall, EngineResult, LlmRunMeta | `shared/types/turn.ts` |
| Contrato da API do GM | `shared/types/gm.ts` |
| Dados (RNG com seed, gravação, RollRecord) | `shared/engine/dice.ts` |
| Testes, dano, armadura, ferimentos | `shared/engine/checks.ts`, `health.ts`, `combat.ts` |
| Registro de ferramentas | `shared/engine/tools/` (`registry`, `queries`, `actions`, `mutations`) |
| Mundo (flags, relógio, fila de eventos, efeitos, missões por flag, ameaça) | `shared/engine/world.ts` |
| Event log (`emit`, ids `campanha:linha:tN:eK`) | `shared/engine/events.ts` |
| Memória (tipos, relevância, automáticas, poda) | `shared/engine/memory.ts` |
| Engenharia de contexto | `shared/engine/context.ts` |
| Pipeline do turno (funções puras) | `shared/engine/turn.ts` |
| Verificador de consistência | `shared/engine/consistency.ts` |
| Migração de saves (v2 → v3) | `shared/engine/migrate.ts` |
| Provedor LLM (interface + Gemini) | `server/gamemaster/llmClient.ts` |
| Prompts por papel + `PROMPT_VERSION` | `server/gamemaster/systemPrompt.ts` |
| Orquestração + observabilidade | `server/gamemaster/gameMaster.ts` |
| Orquestração do turno no cliente | `src/store/turnController.ts` |
| Snapshots, rewind e branches | `src/store/timeline.ts` |
| Persistência local (IndexedDB) | `src/services/repository.ts` |
| NPCs: perfil, objetivos, vínculos, o que o jogador sabe, importância | `shared/engine/npcProfile.ts` |
| Frentes do mundo (mistura de átomos, relógio, NCNet, costura) | `shared/engine/fronts.ts`, `shared/rules/storyAtoms.ts`, `shared/rules/storyCatalog.ts` |

## 3. Ferramentas

- **Consulta** (intérprete): `get_character`, `get_scene`, `get_location`, `get_npc`, `get_quest`, `get_inventory`, `get_relationship`, `lookup_lore`.
- **Ação** (intérprete): `attack`, `skill_check`, `persuade`, `intimidate`, `hack`, `speak`, `move_location`, `buy_item`, `pay_money`, `use_item`, `reload`, `equip_item`, `rest`, `loot`.
- **Mutação** (narrador/telefone), sempre limitadas, atribuídas e registradas:
  - relações e reputação: `modify_relationship`, `modify_reputation`, `modify_heat`, `modify_faction`;
  - mundo e cena: `set_flag`, `update_scene`, `advance_time`, `schedule_event`, `cancel_event`;
  - NPCs e mensagens: `upsert_npc`, `npc_status`, `send_message`;
  - profundidade dos NPCs: `npc_profile`, `npc_goal`, `npc_bond`, `reveal_npc` (o que o jogador sabe só sobe por aqui);
  - frentes do mundo: `front_update` (adiantar, atrasar, deter, o jogador desconfia/descobre);
  - missões: `start_quest`, `update_quest`, `complete_quest`, `fail_quest`;
  - itens e dinheiro: `give_item`, `remove_item`, `transfer_money`;
  - corpo e efeitos: `damage`, `heal`, `stabilize`, `add_injury`, `remove_injury`, `add_effect`, `modify_humanity`, `add_cyberware`, `award_ip`;
  - memória: `create_memory`, `update_memory`;
  - combate: `start_combat`, `update_combatant`, `end_combat`.

Cada ferramenta é declarada **uma vez** (`ParamSpec`). Dessa declaração saem a validação, o JSON Schema e a documentação do prompt.
Para adicionar uma ferramenta, basta um `defineTool` em `tools/*.ts`. Não é preciso mexer em prompt nem em schema.

**Dinheiro e itens não são inventados:**
- Pagamento por trabalho vem de `start_quest.rewardEddies`, pago uma única vez pelo motor ao concluir.
- Compras usam a tabela de preços do motor (`rules/catalog.ts`).
- O conteúdo do loot é decidido pelo motor.
- Transferências avulsas do narrador são limitadas (€$1000 de entrada) e precisam de contraparte.
- Gastos do jogador (dívida, conta, suborno) passam por `pay_money`, que confere o saldo.
- Se a narração descrever um pagamento que o motor não registrou, o verificador de consistência pede reescrita.

**Autocorreção:** antes de executar, o cliente valida as chamadas do intérprete (`validateToolCalls`). Se houver argumento inválido, pede uma nova interpretação uma vez, com o erro e os parâmetros aceitos. Campos descritivos (motivo, origem) são opcionais, com padrão, para que um detalhe não derrube a ação.

## 4. Snapshots, rewind e branches

- `turn_start`: estado **antes** do turno N. Serve para voltar a esse ponto ou ramificar a partir dele.
- `post_engine`: estado depois do motor e antes da narração. Serve para **regenerar a narração** mantendo a mecânica.
- `branch`: pontas de linhas do tempo, para retomar outra linha depois.
- Retenção: todos os `turn_start` dos últimos 40 turnos, depois 1 a cada 10. `post_engine` só dos 3 últimos.
- IDs rastreáveis: `campanha:linha:tN:kind`.

## 5. Persistência (banco)

**Situação atual:** não há servidor de banco nem ORM. O jogo roda local e single-player:
- `localStorage`: estado corrente (`nightlife_state_v2`, schema v3), 3 slots e preferências de UI.
- **IndexedDB** (navegador): `turns`, `snapshots` e `llm_runs`, que não cabem no `localStorage`.

Personagem, NPCs, missões, itens, relações, memórias, flags e eventos agendados vivem **dentro** do documento `GameState`. Hoje isso é o mais simples e consistente, porque tudo é versionado junto.

**Quando valer a pena um banco no servidor** (multi-dispositivo, contas, análise), a proposta mínima em SQL (SQLite/Postgres) é:

```sql
games(id PK, owner_id, title, created_at, current_branch_id)
branches(id PK, game_id FK, parent_branch_id, branched_from_turn, created_at)
game_states(game_id FK, branch_id FK, version INT, state JSONB, updated_at,
            PRIMARY KEY (game_id, branch_id))          -- documento atual (optimistic lock por version)
turns(turn_id PK, game_id FK, branch_id FK, turn INT, phase, player_input, parsed_intent JSONB,
      tool_calls JSONB, dice_rolls JSONB, checks JSONB, engine_result JSONB, narration TEXT,
      state_version_before INT, state_version_after INT, started_at, completed_at)
events(id PK, game_id FK, branch_id FK, turn_id FK, type, source, target, value JSONB, data JSONB, game_time, created_at)
snapshots(id PK, game_id FK, branch_id FK, turn INT, kind, state_version INT, state JSONB, created_at)
llm_runs(request_id PK, game_id FK, turn_id, purpose, provider, model, model_version, prompt_version,
         input_tokens, output_tokens, cached_tokens, latency_ms, attempts JSONB, tools_called JSONB,
         retrieved_memories JSONB, errors JSONB, degraded BOOL, created_at)
```

`characters`, `npcs`, `quests`, `items`, `relationships`, `memories`, `world_flags` e `scheduled_events` **não** viram tabelas próprias por enquanto. Ficam no `state` JSONB, com índices de expressão se for preciso consultar. Assim não há duas fontes de verdade.
O `CampaignRepository` em `src/services/repository.ts` já é a interface para essa troca (IndexedDB → API).

## 6. Observabilidade

Cada chamada ao LLM gera um `LlmRunMeta` com os seguintes campos:
- identificação: `requestId`, `sessionId`, `turnId`, `purpose`;
- modelo: `provider`, `model`, `modelVersion`, `promptVersion`;
- uso: tokens (entrada, saída, cache), latência e tentativas por modelo;
- contexto: `toolsCalled`, `retrievedMemories`;
- falhas: `errors` (inclui as contradições detectadas) e `degraded`.

O servidor loga uma linha JSON por chamada (`tag: llm_run`). O cliente guarda em `llm_runs` e no `TurnRecord`.
Para ver na UI: **Menu → Registro e rewind → Turnos**.

## 7. Trocar de modelo ou de provedor

Basta implementar `LlmProvider` (`generate({ system, prompt, schema, mode })`) e passá-lo a `createGameMaster(provider)` em `server.ts`.
Os schemas são JSON Schema padrão, e o motor não conhece o provedor.

## 8. Testes e evals

- `npm test` roda o motor, o servidor (com provedor falso), o store, a UI, o rádio e os evals de consistência.
- `npm run eval` roda só os evals de consistência (`evals/consistency.eval.ts`, TEST 001–006 e outros).
- `npm run eval:live` roda os evals contra o modelo real (gasta tokens).

Para criar um eval, use a DSL de `evals/harness.ts`:

```ts
const sc = scenario().atTurn(20).tool('narrator', 'npc_status', { npcId: 'npc_rafa', status: 'dead' });
sc.atTurn(50).tool('interpreter', 'speak', { npcId: 'npc_rafa' });
expect(sc.last().ok).toBe(false);
```

## 9. Fidelidade ao Cyberpunk RED

Coberto pelo motor e verificado em `evals/red-rules.eval.ts`:
- **Testes e críticos:** STAT + perícia + 1d10; 10 explode e 1 implode.
- **Ferimentos:** PV = 10 + 5×⌈(BODY+WILL)/2⌉. Gravemente ferido dá −2; mortalmente ferido dá −4 (e −6 em MOVE).
- **Teste de Morte:** 1d10 + penalidade ≤ BODY; 10 natural sempre falha. A penalidade sobe +1 por teste e +1 por Ferimento Crítico.
- **Distância:** DV por faixa conforme o livro.
- **Dano:** mira na cabeça −8 e dano ×2; ablação de −1 de SP; crítico (dois 6) dá +5 direto.
- **Armas brancas:** ignoram metade da SP, arredondada para cima.
- **Briga:** dano pelo BODY (1d6/2d6/3d6/4d6) e não perfura armadura.
- **Armadura pesada:** −2 (SP 12–13) ou −4 (SP 15+) em REF/DEX/MOVE, inclusive na iniciativa.
- **Outros:** esquiva com REF 8+, iniciativa REF + 1d10, point-buy de 62 (2–8), Humanidade/EMP, ROF 2, rajada e fogo de supressão.
- **Habilidades de Papel:** Consciência de Combate, Interface, Fabricante, Medicina, Operador e Moto; com alocação, custo de PM e efeitos mecânicos.
- **Netrunning:** arquiteturas, andares, senhas, arquivos, nós de controle, programas, ICE Negro, REZ, rastros e desconexão segura/insegura.

Próximas expansões recomendadas (não são lacunas de implementação básica):
1. **Economia de disponibilidade:** estoque por loja/Medtech, Mercado Noturno, encomendas por Canal e reabastecimento por tempo.
2. **Netrunning persistente:** demônios autônomos, contramedidas corporativas, rastreamento e consequências fora da arquitetura.
3. **Veículos e perseguições:** integridade, manobras, dano e upgrades da Moto.
4. **Cobertura espacial:** objetos destrutíveis e linha de tiro, além da abstração atual por faixa.

A "meia cobertura" (+2 no DV) é uma regra da casa; no RED, cobertura bloqueia a linha de tiro.

## 10. Apresentação (som e efeitos)

- **Áudio** (`src/services/audio.ts`): tudo sintetizado, passando por um barramento master (compressor, reverb curto e volume). Inclui dados (chocalho e batida), crítico, falha crítica, impacto, sirene, notificação, teclas de terminal, boot, glitch e revelação da narração.
- **Efeitos visuais** (`src/features/vfx`): scanlines e vinheta; pulso vermelho com PV baixo; flash e tremor ao tomar dano; flash verde no 10 natural; glitch no 1 natural; sirene ao iniciar combate. Desligáveis nas Configurações e respeitam `prefers-reduced-motion`.
- **Narração nova** entra trecho a trecho. **Introdução em console** (`src/features/intro`) com boot e contexto de Night City; pode ser pulada e revista.

## 11. Decisões e limites conhecidos

- Rolagens usam 1d10 (Cyberpunk RED), não 1d20. A arquitetura (`RollRecord`, `recordingRng`) aceita outros dados.
- O jogador ainda clica em "Rolar". A rolagem é do motor; o clique preserva a agência e o uso de Sorte.
- Ações com rolagem fazem 2 chamadas ao LLM (interpretar e narrar); ações simples também. O intérprete sempre usa o modelo flash.
- Iniciativa aplicada (`shared/engine/initiative.ts`): depois da Ação do jogador, aliados e inimigos agem na ordem (os mais lentos fecham a rodada; os mais rápidos abrem a próxima), ANTES da narração. `enemyActions` do narrador só vale no turno em que ele inicia o combate.
- Equipe (`shared/engine/party.ts`): aliados controlados pelo motor; o jogador pede (`ask_ally`) e o aliado aceita, adapta ou recusa. PV persistem entre lutas; parte do pagamento descontada ao concluir missão.
- Quickhacks do Trilheiro (`shared/engine/quickhacks.ts`, `shared/rules/quickhacks.ts`): árvore 3×4, RAM do deck, Interface + 1d10 contra a defesa do alvo.
- O verificador de consistência é heurístico: pega os casos críticos (disparo sem munição, morto falando, acerto/erro invertido).
