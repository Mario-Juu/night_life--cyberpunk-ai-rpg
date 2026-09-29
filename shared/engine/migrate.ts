/**
 * Migração de saves entre versões do estado. v2 → v3 preenche os novos
 * campos (sessão, cena, flags, efeitos, fila de eventos, histórico, NPC/memórias tipadas).
 */
import { STATE_VERSION, type GameState, type Memory, type MemoryType } from '../types/game';
import { makeId } from './ids';
import { MAIN_BRANCH } from './initialState';

/** Dados de save antigos, sem tipo garantido. */
type Loose = Record<string, any>;

const LEGACY_EVENT_TYPE: Record<string, string> = {
  damage: 'DAMAGE_TAKEN',
  heal: 'HEALED',
  money: 'MONEY_CHANGED',
  item: 'ITEM_ACQUIRED',
  npc: 'NPC_UPDATED',
  mission: 'QUEST_UPDATED',
  combat: 'ATTACK_RESOLVED',
  location: 'PLAYER_MOVED',
  phone: 'MESSAGE_SENT',
  rejected: 'TOOL_REJECTED',
  roll: 'CHECK_RESOLVED',
  system: 'SYSTEM',
};

export function migrateState(raw: unknown): GameState {
  const s = raw as Loose;
  if (!s || typeof s !== 'object') throw new Error('Save vazio.');
  if (s.version === STATE_VERSION) return s as GameState;
  if (s.version !== 2) throw new Error('Save de uma versão antiga demais para migrar.');

  const turnId = (t: number) => `${s.id}:${MAIN_BRANCH}:t${t}`;
  return {
    ...s,
    version: STATE_VERSION,
    session: { version: 0, branchId: MAIN_BRANCH, parentBranchId: null, branchedFromTurn: null },
    scene: { id: makeId('scene'), description: s.world?.location?.spot ?? '', presentNpcIds: [], threat: s.combat?.active ? 'high' : 'low', startedTurn: s.turn ?? 0 },
    flags: {},
    activeEffects: [],
    scheduled: [],
    history: { summaries: [], summarizedUpToTurn: 0 },
    npcs: (s.npcs ?? []).map((n: Loose) => ({ respect: 30, fear: 0, anger: 0, knowledge: [], ...n })),
    missions: (s.missions ?? []).map((m: Loose) => ({ rewardEddies: 0, startedTurn: 0, ...m })),
    memories: (s.memories ?? []).map(
      (m: Loose): Memory => ({
        id: m.id ?? makeId('mem'),
        type: ((m.tags ?? []).includes('phone') ? 'NPC_MEMORY' : 'CAMPAIGN_MEMORY') as MemoryType,
        subject: m.subject ?? 'campanha',
        content: m.content ?? '',
        importance: m.importance ?? 5,
        confidence: 0.9,
        createdTurn: m.turn ?? 0,
        lastRelevantTurn: m.turn ?? 0,
        tags: m.tags ?? [],
      }),
    ),
    events: (s.events ?? []).map((e: Loose, i: number) => ({
      ...e,
      id: `${turnId(e.turn ?? 0)}:legacy${i}`,
      turnId: turnId(e.turn ?? 0),
      type: LEGACY_EVENT_TYPE[e.type] ?? 'SYSTEM',
    })),
  } as unknown as GameState;
}
