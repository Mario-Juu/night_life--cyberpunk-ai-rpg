/**
 * Harness de evals de consistência do RPG.
 * Cenários são escritos como uma sequência de passos sobre o motor real (sem LLM):
 *
 *   const sc = scenario().tool('narrator', 'upsert_npc', { name: 'Judy' }).atTurn(50);
 *   expect(sc.npc('Judy')?.status).toBe('alive');
 *
 * Para evals com o modelo de verdade, veja evals/live.
 */
import type { GameState, RollOutcome } from '../shared/types/game';
import type { ToolCallRecord, ToolOrigin } from '../shared/types/turn';
import { STAT_PRESETS, buildCharacter, type CreationInput } from '../shared/rules/creation';
import { createInitialState } from '../shared/engine/initialState';
import { REGISTRY, runToolCalls } from '../shared/engine/tools';
import { sequenceRng } from '../shared/engine/dice';
import { resolveRoll } from '../shared/engine/rolls';
import { gameReducer } from '../shared/engine/reducer';
import { advanceTime } from '../shared/engine/world';
import { buildGameContext } from '../shared/engine/context';
import { CYBERWARE } from '../shared/rules/cyberware';

export interface Scenario {
  state: GameState;
  records: ToolCallRecord[];
  lastOutcome: RollOutcome | null;
  /** Executa uma ferramenta pelo registro (validação real do motor). */
  tool(origin: ToolOrigin, name: string, args?: Record<string, unknown>, dice?: number[]): Scenario;
  /** Resolve o teste pendente com dados determinísticos. */
  roll(dice: number[], luck?: number): Scenario;
  advance(minutes: number): Scenario;
  atTurn(turn: number): Scenario;
  edit(fn: (s: GameState) => GameState): Scenario;
  last(): ToolCallRecord;
  npc(nameOrId: string): GameState['npcs'][number] | undefined;
  item(nameOrId: string): GameState['character']['inventory'][number] | undefined;
  /** Serializa e restaura (simula recarregar a campanha). */
  reload(): Scenario;
  context(query?: string): ReturnType<typeof buildGameContext>;
}

/** Coloca um ripperdoc na cena (nível 5, mercado negro, confia no jogador) — para testes de cromo. */
export function withRipperdoc(s: GameState, tier: 1 | 2 | 3 | 4 | 5 = 5, blackMarket = true, trust = 60): GameState {
  // Estoque com o catálogo inteiro: estes testes medem as regras de acesso (nível, mercado negro,
  // protótipo, confiança), que vêm ANTES do estoque. A vitrine sorteada tem os próprios testes.
  const stock = Object.keys(CYBERWARE);
  const doc = { id: 'npc_doc', name: 'Doc', role: 'Ripperdoc', description: '', trust, respect: 30, fear: 0, anger: 0, knowledge: [], status: 'alive' as const, isContact: false, ripperdoc: { tier, blackMarket, stock } };
  return { ...s, npcs: [...s.npcs.filter(n => n.id !== doc.id), doc], scene: { ...s.scene, presentNpcIds: [...s.scene.presentNpcIds.filter(id => id !== doc.id), doc.id] } };
}

export function scenario(overrides: Partial<CreationInput> = {}): Scenario {
  const character = buildCharacter({
    name: 'Matt',
    handle: 'Matt',
    age: 24,
    role: 'solo',
    occupation: 'Entregador',
    district: 'HEYWOOD',
    familyTie: 'Minha irmã, Lu',
    debtReason: 'Aluguel atrasado',
    personalAnchor: 'Sair da cidade',
    appearance: '',
    stats: { ...STAT_PRESETS[0].stats },
    starterWeaponId: 'revolver',
    ...overrides,
  });

  const sc: Scenario = {
    state: createInitialState(character),
    records: [],
    lastOutcome: null,
    tool(origin, name, args = {}, dice = [5]) {
      const res = runToolCalls(REGISTRY, sc.state, [{ tool: name, args }], { rng: sequenceRng(dice), origin });
      sc.state = res.state;
      sc.records.push(...res.records);
      return sc;
    },
    roll(dice, luck = 0) {
      if (!sc.state.pendingRoll) throw new Error('Nenhuma rolagem pendente.');
      const outcome = resolveRoll(sc.state, sc.state.pendingRoll, luck, sequenceRng(dice));
      sc.state = gameReducer(sc.state, { type: 'rollResolved', outcome });
      sc.lastOutcome = outcome;
      return sc;
    },
    advance(minutes) {
      sc.state = advanceTime(sc.state, minutes);
      return sc;
    },
    atTurn(turn) {
      sc.state = { ...sc.state, turn };
      return sc;
    },
    edit(fn) {
      sc.state = fn(sc.state);
      return sc;
    },
    last() {
      const r = sc.records.at(-1);
      if (!r) throw new Error('Nenhuma ferramenta executada.');
      return r;
    },
    npc(q) {
      const lower = q.toLowerCase();
      return sc.state.npcs.find(n => n.id === q || n.name.toLowerCase() === lower);
    },
    item(q) {
      const lower = q.toLowerCase();
      return sc.state.character.inventory.find(i => i.id === q || i.name.toLowerCase() === lower);
    },
    reload() {
      sc.state = JSON.parse(JSON.stringify(sc.state));
      return sc;
    },
    context(query = '') {
      return buildGameContext(sc.state, query);
    },
  };
  return sc;
}
