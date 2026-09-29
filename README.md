# NIGHT//LIFE — RPG cyberpunk com Mestre de IA

RPG narrativo solo em Night City. Um LLM (Gemini) narra a história. Um motor de regras determinístico, baseado em Cyberpunk RED, resolve tudo o que é mecânico: testes, ataques, armadura, munição, ferimentos e Teste de Morte.

## Rodar localmente

Pré-requisito: Node.js 20 ou superior.

1. Instale as dependências: `npm install`
2. Copie `.env.example` para `.env` e preencha `GEMINI_API_KEY`.
3. Inicie: `npm run dev` e abra http://localhost:3000

Sem uma chave válida, o jogo funciona em **modo degradado**: o Mestre responde com um aviso e o mundo não avança.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Servidor Express com Vite em modo middleware |
| `npm test` | Toda a suíte vitest (motor, servidor, store, UI, rádio, evals de consistência) |
| `npm run eval` | Só os evals de consistência do RPG |
| `npm run eval:live` | Evals contra o modelo real (gasta tokens) |
| `npm run lint` | `tsc --noEmit` em modo strict |
| `npm run build` | Build de produção do cliente |

## Arquitetura

O LLM interpreta a intenção e narra. Um **motor de regras determinístico** (Cyberpunk RED) é a fonte de verdade.
Cada ação vira um **turno rastreável**: intenção, ferramentas, dados com seed, eventos, snapshots, memórias e metadados do modelo.

```
JOGADOR → INTÉRPRETE (LLM) → MOTOR (ferramentas, regras, dados) → SNAPSHOT → NARRADOR (LLM) → MOTOR (consequências) → UI
```

Detalhes completos (fluxo, ferramentas, persistência, proposta de banco, observabilidade, evals) estão em
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Na interface:
- **Menu → Registro e rewind** tem três abas: Eventos (log estruturado), Turnos (inspetor: intenção, ferramentas, testes, seed, modelo, tokens, latência) e Linha do tempo (voltar para antes de um turno, ramificar ou retomar outra linha).
- Na última narração, **Regenerar narração** mantém a mesma mecânica.

### Saves

- **Estado atual:** fica no `localStorage` (schema v3). Saves v2 são migrados automaticamente.
- **Turnos, snapshots e chamadas ao LLM:** ficam no IndexedDB do navegador, sem servidor de banco.
- **Slots e arquivos:** há 3 slots, além de exportar e importar em JSON.
