/**
 * Migração de saves entre versões do estado. v2 → v3 preenche os novos
 * campos (sessão, cena, flags, efeitos, fila de eventos, histórico, NPC/memórias tipadas).
 */
import { STATE_VERSION, type GameState, type Memory, type MemoryType } from '../types/game';
import { makeId } from './ids';
import { MAIN_BRANCH } from './initialState';
import { withRoleDefaults } from './roles';
import { starterDeck } from './net';
import { implantFromName } from '../rules/cyberware';

/** Campos adicionados dentro da v3 (habilidades de papel, Rede): preenche sem mudar a versão. */
function fillDefaults(s: GameState): GameState {
  let character = withRoleDefaults(s.character);
  if (character.bio.role === 'netrunner' && !character.deck) character = { ...character, deck: starterDeck() };
  // Trilheiros de saves antigos: o Neural Link + Plugues passaram a ser cromo de verdade (sem cobrar Humanidade retroativa).
  if (character.bio.role === 'netrunner' && !(character.cyberware ?? []).some(cw => cw.key === 'interface_plugs')) {
    const link = { id: makeId('cw'), key: 'neural_link', name: 'Neural Link', category: 'Neuralware' as const, humanityLoss: 0, description: 'Fundação da neuralware.' };
    const plugs = { id: makeId('cw'), key: 'interface_plugs', name: 'Plugues de Interface', category: 'Neuralware' as const, humanityLoss: 0, description: 'Conexão direta com o ciberdeck.', parentId: link.id };
    character = { ...character, cyberware: [...(character.cyberware ?? []).filter(cw => cw.key !== 'neural_link'), link, plugs] };
  }
  // Implantes que entraram como item comum (arma/equipamento sem cirurgia — bug antigo) viram peça solta.
  if (character.inventory.some(i => !i.implant && !i.cyberKey && implantFromName(i.name))) {
    character = {
      ...character,
      inventory: character.inventory.map(i => {
        const def = !i.implant && !i.cyberKey ? implantFromName(i.name) : undefined;
        if (!def) return i;
        return { id: i.id, name: `${def.name}${def.brand ? ` (${def.brand})` : ''} — peça solta`, category: 'gear' as const, quantity: 1, description: `${def.effect} Precisa de um ripperdoc para instalar.`, value: 0, cyberKey: def.key };
      }),
    };
  }
  // Categorias renomeadas (Cyber- → Ciber-).
  if (character.cyberware?.some(cw => /^Cyber/.test(cw.category))) character = { ...character, cyberware: character.cyberware.map(cw => ({ ...cw, category: cw.category.replace(/^Cyber/, 'Ciber') as typeof cw.category })) };
  // O custo de vida automático saiu (o aluguel agora é orgânico, da ficção): limpa saves que o tinham.
  const { lifestyle: _dropped, ...rest } = s as GameState & { lifestyle?: unknown };
  return { ...rest, character, net: s.net ?? { architecture: null, run: null } };
}

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
  if (s.version === STATE_VERSION) return fillDefaults(s as GameState);
  if (s.version !== 2) throw new Error('Save de uma versão antiga demais para migrar.');

  const turnId = (t: number) => `${s.id}:${MAIN_BRANCH}:t${t}`;
  return fillDefaults({
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
  } as unknown as GameState);
}
