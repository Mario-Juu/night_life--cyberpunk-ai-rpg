/**
 * Memória estruturada: tipos, relevância, memórias automáticas a partir de eventos
 * e poda de memórias banais.
 */
import type { GameEvent, GameState, Memory, MemoryType } from '../types/game';
import { makeId } from './ids';

const TYPE_WEIGHT: Record<MemoryType, number> = {
  CAMPAIGN_MEMORY: 2,
  NPC_MEMORY: 1.5,
  CHARACTER_MEMORY: 1.5,
  WORLD_MEMORY: 1,
  PLAYER_MEMORY: 1,
  SCENE_MEMORY: 0.5,
};

export const MEMORY_CAP = 200;

function norm(text: string) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const words = (text: string) => ` ${norm(text).replace(/[^a-z0-9]+/g, ' ').trim()} `;

/**
 * O texto cita este nome como PALAVRA inteira? Substring solta misturava gente e lugares:
 * "rafa" casava com "Rafael", "ana" com "banana", e a memória/NPC errado entrava no contexto.
 */
export function mentionsName(text: string, name: string): boolean {
  const n = words(name).trim();
  return n.length > 2 && words(text).includes(` ${n} `);
}

/**
 * A memória está LIGADA à cena/ação (assunto citado, NPC presente, lugar atual, missão ativa)?
 * Palavra comum em comum ("hotel", "arquivos") não liga: era assim que o hotel de outra trama
 * entrava como se fosse o hotel de agora.
 */
export function memoryLinked(state: Pick<GameState, 'npcs' | 'world' | 'scene' | 'missions'>, mem: Memory, query: string): boolean {
  // O que é do próprio personagem anda com ele: nunca é "de outro lugar".
  if (mem.subject === 'player' || mem.type === 'CHARACTER_MEMORY' || mem.type === 'PLAYER_MEMORY') return true;
  const npc = state.npcs.find(n => n.id === mem.subject);
  if (npc && (state.scene.presentNpcIds.includes(npc.id) || mentionsName(query, npc.name.split(/\s+/)[0]) || mentionsName(query, npc.name))) return true;
  if (!npc && mentionsName(query, mem.subject)) return true;
  const loc = state.world.location;
  if ([loc.spot, loc.subDistrict].some(p => p && (norm(p) === norm(mem.subject) || mentionsName(mem.content, p)))) return true;
  return state.missions.some(m => m.status === 'ACTIVE' && (m.id === mem.subject || (m.giverId && m.giverId === mem.subject)));
}

/**
 * Pontua memórias por: assunto citado na ação, NPC presente na cena, local atual,
 * missão ativa, importância, confiança e recência (último uso).
 */
export function scoreMemory(state: Pick<GameState, 'npcs' | 'world' | 'turn' | 'scene' | 'missions'>, mem: Memory, query: string): number {
  const q = norm(query);
  const subject = norm(mem.subject);
  const content = norm(mem.content);
  const npc = state.npcs.find(n => n.id === mem.subject);
  let score = mem.importance * 1.5 * mem.confidence + TYPE_WEIGHT[mem.type];

  const names = [subject, npc ? norm(npc.name).split(/\s+/)[0] : ''].filter(w => w.length > 2);
  if (names.some(n => mentionsName(q, n))) score += 8;
  if (q.split(/\W+/).some(w => w.length > 4 && content.includes(w))) score += 3;
  if (npc && state.scene.presentNpcIds.includes(npc.id)) score += 6;
  if (content.includes(norm(state.world.location.district)) || subject === norm(state.world.location.district)) score += 3;
  if (state.missions.some(m => m.status === 'ACTIVE' && (m.id === mem.subject || content.includes(norm(m.title))))) score += 4;

  const idle = Math.max(0, state.turn - mem.lastRelevantTurn);
  score -= Math.min(6, idle * 0.15);
  return score;
}

export function retrieveMemories(state: GameState, query: string, max = 8): Memory[] {
  return state.memories
    .map(m => ({ m, s: scoreMemory(state, m, query) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map(x => x.m);
}

/** Marca memórias como relevantes neste turno (elas resistem mais à poda). */
export function touchMemories(state: GameState, ids: string[]): GameState {
  if (!ids.length) return state;
  const set = new Set(ids);
  return { ...state, memories: state.memories.map(m => (set.has(m.id) ? { ...m, lastRelevantTurn: state.turn } : m)) };
}

/** Eventos que viram memória automaticamente (o LLM não precisa "lembrar"). */
export function memoryFromEvent(e: GameEvent, state: GameState): Omit<Memory, 'id'> | null {
  const base = { confidence: 1, createdTurn: e.turn, lastRelevantTurn: e.turn, tags: [e.type.toLowerCase()] };
  switch (e.type) {
    case 'QUEST_STARTED':
    case 'QUEST_COMPLETED':
    case 'QUEST_FAILED':
      return { ...base, type: 'CAMPAIGN_MEMORY', subject: e.target ?? 'missão', content: e.summary, importance: e.type === 'QUEST_STARTED' ? 6 : 8 };
    case 'NPC_DIED':
      return { ...base, type: 'NPC_MEMORY', subject: e.target ?? 'npc', content: e.summary, importance: 9 };
    case 'NPC_MET':
      return { ...base, type: 'NPC_MEMORY', subject: e.target ?? 'npc', content: e.summary, importance: 5 };
    case 'RELATIONSHIP_CHANGED': {
      const delta = typeof e.value === 'number' ? e.value : 0;
      if (Math.abs(delta) < 10) return null;
      const npc = state.npcs.find(n => n.id === e.target);
      return { ...base, type: 'NPC_MEMORY', subject: e.target ?? 'npc', content: `${npc?.name ?? e.target} ${delta > 0 ? 'passou a confiar mais' : 'passou a confiar menos'} no jogador. ${e.summary}`, importance: 7 };
    }
    case 'WORLD_FLAG_CHANGED':
      if ((e.data as { visibility?: string } | undefined)?.visibility === 'hidden') return null;
      return { ...base, type: 'WORLD_MEMORY', subject: e.target ?? 'mundo', content: `Fato do mundo: ${e.summary}`, importance: 6 };
    case 'CYBERWARE_INSTALLED':
    case 'INJURY_ADDED':
      return { ...base, type: 'CHARACTER_MEMORY', subject: 'player', content: e.summary, importance: 6 };
    default:
      return null;
  }
}

/** Cria memórias automáticas para os eventos do turno. Retorna os ids criados. */
export function memoriesFromEvents(state: GameState, events: GameEvent[]): { state: GameState; created: string[] } {
  const created: string[] = [];
  let memories = state.memories;
  for (const e of events) {
    const draft = memoryFromEvent(e, state);
    if (!draft) continue;
    if (memories.some(m => m.subject === draft.subject && m.content === draft.content)) continue;
    const mem: Memory = { id: makeId('mem'), ...draft };
    memories = [...memories, mem];
    created.push(mem.id);
  }
  return { state: created.length ? { ...state, memories } : state, created };
}

/**
 * Poda: memórias banais (importância ≤ 3) esquecidas há 25+ turnos somem;
 * acima do limite, saem as de menor valor. Importantes permanecem.
 */
export function pruneMemories(state: GameState): GameState {
  let memories = state.memories.filter(m => !(m.importance <= 3 && state.turn - m.lastRelevantTurn > 25));
  if (memories.length > MEMORY_CAP) {
    const value = (m: Memory) => m.importance * m.confidence - Math.max(0, state.turn - m.lastRelevantTurn) * 0.05;
    const keep = new Set([...memories].sort((a, b) => value(b) - value(a)).slice(0, MEMORY_CAP).map(m => m.id));
    memories = memories.filter(m => keep.has(m.id));
  }
  return memories.length === state.memories.length ? state : { ...state, memories };
}
