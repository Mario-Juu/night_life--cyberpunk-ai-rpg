/**
 * Registro automático de personagens: quem fala na cena passa a existir no mundo,
 * mesmo que o narrador esqueça de chamar `upsert_npc`. Sem duplicatas.
 */
import type { Dialogue, GameState, Npc } from '../types/game';
import { formatGameTime } from '../rules/world';
import { parseNarration } from './narration';
import { emit } from './events';
import { slugId } from './ids';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["'“”‘’`´()[\]]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const firstToken = (name: string) => normalizeName(name).split(' ')[0] ?? '';

/**
 * Busca tolerante: nome exato → nome normalizado → mesmo primeiro nome (só se for único).
 * "Jax" encontra "Jax 'Kettle'"; "Rafa" encontra 'Rafa "Zero-Um"'.
 */
export function findNpcLoose(state: Pick<GameState, 'npcs'>, name: string): Npc | undefined {
  const exact = state.npcs.find(n => n.id === name || n.name.toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact;
  const norm = normalizeName(name);
  if (!norm) return undefined;
  const byNorm = state.npcs.find(n => normalizeName(n.name) === norm);
  if (byNorm) return byNorm;
  const first = firstToken(name);
  if (first.length < 3) return undefined;
  const byFirst = state.npcs.filter(n => firstToken(n.name) === first);
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

const GENERIC = /^(voz|vozes|narrador|sistema|r[aá]dio|an[uú]ncio|alto[- ]?falante|tv|holo|holograma|interfone|comunicador|agent|agente|ia|computador|terminal|multid[aã]o|todos|algu[eé]m|desconhecid[oa]|estranh[oa]|voc[eê])(?=[\s,.:;!?-]|$)/i;

/** Falas que NÃO são personagens (vozes genéricas, sistemas, o próprio jogador). */
export function isGenericSpeaker(name: string, state: Pick<GameState, 'character'>): boolean {
  const n = name.trim();
  if (n.length < 2 || n.length > 60) return true;
  if (GENERIC.test(n)) return true;
  const norm = normalizeName(n);
  const player = [state.character.bio.name, state.character.bio.handle].map(normalizeName).filter(Boolean);
  return player.some(p => p === norm || firstToken(p) === firstToken(n));
}

/** Quem fala numa narração (tags [DIALOGUE] + lista `dialogues`), sem repetição. */
export function speakersOf(narration: string, dialogues: Dialogue[] = []): string[] {
  const names = [
    ...parseNarration(narration).flatMap(s => (s.kind === 'dialogue' ? [s.speaker] : [])),
    ...dialogues.map(d => d.speaker),
  ].map(s => s.trim());
  const seen = new Set<string>();
  return names.filter(n => {
    const key = normalizeName(n);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Cria (se preciso) o NPC para um nome. Não mexe em NPCs existentes. */
export function ensureNpc(state: GameState, name: string, extra: Partial<Npc> = {}): { state: GameState; npc: Npc; created: boolean } {
  const existing = findNpcLoose(state, name);
  if (existing) return { state, npc: existing, created: false };
  const base = slugId('npc', name);
  const npc: Npc = {
    id: state.npcs.some(n => n.id === base) ? `${base}_${state.npcs.length}` : base,
    name: name.trim(),
    role: 'Apresentado em cena',
    description: '',
    trust: 0,
    respect: 30,
    fear: 0,
    anger: 0,
    knowledge: [],
    status: 'alive',
    isContact: false,
    location: state.world.location.district,
    lastInteraction: formatGameTime(state.world.time).time,
    ...extra,
  };
  const next = emit({ ...state, npcs: [...state.npcs, npc] }, 'NPC_MET', `Conheceu ${npc.name}`, { target: npc.id, data: { auto: true } });
  return { state: next, npc, created: true };
}

/**
 * Registra quem falou na cena e marca como presente.
 * Mortos não "voltam" (a fala é ignorada — o verificador de consistência cuida disso).
 */
export function registerSpeakers(state: GameState, speakers: string[]): { state: GameState; created: string[] } {
  let s = state;
  const created: string[] = [];
  const present = new Set(s.scene.presentNpcIds);
  for (const name of speakers) {
    if (isGenericSpeaker(name, s)) continue;
    const res = ensureNpc(s, name);
    s = res.state;
    if (res.created) created.push(res.npc.id);
    if (res.npc.status !== 'dead') present.add(res.npc.id);
  }
  const presentNpcIds = [...present].filter(id => s.npcs.some(n => n.id === id && n.status !== 'dead'));
  return { state: { ...s, scene: { ...s.scene, presentNpcIds } }, created };
}

/**
 * Recupera saves antigos: cadastra quem já falou no histórico e ainda não existe.
 * Idempotente (pode rodar a cada carregamento). Não altera a cena.
 */
export function backfillNpcsFromChat(state: GameState): GameState {
  let s = state;
  for (const entry of state.chat) {
    if (entry.kind !== 'narration') continue;
    for (const name of speakersOf(entry.text)) {
      if (isGenericSpeaker(name, s) || findNpcLoose(s, name)) continue;
      s = ensureNpc(s, name, { lastInteraction: entry.time }).state;
    }
  }
  return s;
}
