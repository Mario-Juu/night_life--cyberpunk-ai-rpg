/**
 * Registro automático de personagens: quem fala na cena passa a existir no mundo,
 * mesmo que o narrador esqueça de chamar `upsert_npc`. Sem duplicatas.
 */
import type { Dialogue, GameState, Npc, NpcProfile } from '../types/game';
import { formatGameTime } from '../rules/world';
import { parseNarration } from './narration';
import { emit } from './events';
import { slugId } from './ids';
import { syncImportance } from './npcProfile';

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
  const byFirst = state.npcs.filter(n => firstToken(n.name) === first && sameAlias(n.name, name));
  return byFirst.length === 1 ? byFirst[0] : undefined;
}

/**
 * Mesmo primeiro nome só é a mesma pessoa se um nome estende o outro ("Jax" ⊂ "Jax Kettle",
 * "Rafa (holo)" = "Rafa"). "Rafa Lima" e 'Rafa "Zero-Um"' são duas pessoas — antes eram fundidas.
 */
function sameAlias(a: string, b: string): boolean {
  // Só nomes próprios (maiúscula) depois do primeiro contam: "Rafa, o canal" ainda é a Rafa.
  const proper = (s: string) =>
    normalizeName(
      s
        .replace(/\([^)]*\)/g, ' ')
        .split(/[\s,]+/)
        .slice(1)
        .filter(w => /^["'“‘]?\p{Lu}/u.test(w))
        .join(' '),
    );
  const x = proper(a);
  const y = proper(b);
  return !x || !y || x === y || x.startsWith(`${y} `) || y.startsWith(`${x} `);
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
export function registerSpeakers(state: GameState, speakers: string[]): { state: GameState; created: string[]; ids: string[] } {
  let s = state;
  const created: string[] = [];
  const ids: string[] = [];
  const present = new Set(s.scene.presentNpcIds);
  for (const name of speakers) {
    if (isGenericSpeaker(name, s)) continue;
    const res = ensureNpc(s, name);
    s = res.state;
    if (res.created) created.push(res.npc.id);
    ids.push(res.npc.id);
    // Contato do Agent que não estava na cena fala por ligação/mensagem: não "entra" nela só por falar
    // (Rafa aparecia presente numa perseguição). Se ele chegar de verdade, o narrador usa update_scene.
    const remote = !res.created && res.npc.isContact && !present.has(res.npc.id);
    if (res.npc.status !== 'dead' && !remote) present.add(res.npc.id);
  }
  const presentNpcIds = [...present].filter(id => s.npcs.some(n => n.id === id && n.status !== 'dead'));
  return { state: { ...s, scene: { ...s.scene, presentNpcIds } }, created, ids };
}

/**
 * Recupera saves antigos: cadastra quem já falou no histórico e ainda não existe.
 * Idempotente (pode rodar a cada carregamento). Não altera a cena.
 */
export function backfillNpcsFromChat(state: GameState): GameState {
  let s = state;
  for (const entry of state.chat) {
    if (entry.kind === 'narration') {
      for (const name of speakersOf(entry.text)) {
        if (isGenericSpeaker(name, s) || findNpcLoose(s, name)) continue;
        s = ensureNpc(s, name, { lastInteraction: entry.time }).state;
      }
    } else if (entry.kind === 'player') {
      // Contatos que o jogador disse ter salvo em turnos anteriores.
      s = applyContactExchange(s, entry.text).state;
    }
  }
  return syncImportance(backfillInteractions(s));
}

/** Saves anteriores à contagem: interações = turnos distintos em que o NPC falou no histórico. */
function backfillInteractions(state: GameState): GameState {
  const turns = new Map<string, Set<number>>();
  for (const entry of state.chat) {
    if (entry.kind !== 'narration') continue;
    for (const name of speakersOf(entry.text)) {
      const npc = isGenericSpeaker(name, state) ? undefined : findNpcLoose(state, name);
      if (npc) turns.set(npc.id, (turns.get(npc.id) ?? new Set()).add(entry.turn));
    }
  }
  if (!state.npcs.some(n => (turns.get(n.id)?.size ?? 0) > (n.interactions ?? 0))) return state;
  return { ...state, npcs: state.npcs.map(n => ((turns.get(n.id)?.size ?? 0) > (n.interactions ?? 0) ? { ...n, interactions: turns.get(n.id)!.size } : n)) };
}

const HUMAN_TIE = /\b(mae|pai|irma\w*|filh\w*|avo|tia|tio|namorad\w*|espos\w*|marid\w*|amig\w*|prim[oa]s?|companheir\w*|parceir\w*|vizinh\w*|mentor\w*)\b/;
const ANIMAL = /\b(gat[oa]s?|gatinh\w*|felin\w*|cachorr\w*|cao|caes|cadel\w*|dog|cat|pet|pets|papagai\w*|calopsit\w*|passar\w*|periquit\w*|coelh\w*|hamster|furao|peixe\w*|tartarug\w*|iguana|lagart\w*|cobra|porquinho da india|mascote|animal|animais|bichinho\w*|bicho de estimacao)\b/;

/** O texto descreve um animal (e não uma pessoa)? Ex.: "Mingau, meu gato laranja". */
export function looksLikeAnimal(text: string): boolean {
  const t = normalizeName(text);
  return !HUMAN_TIE.test(t) && ANIMAL.test(t);
}

/** Animais não usam o Agent: não viram contato, não mandam nem recebem mensagens. */
export const canUsePhone = (npc: Pick<Npc, 'kind' | 'status'>) => npc.kind !== 'animal' && npc.status !== 'dead';

/**
 * Conserta saves antigos (idempotente):
 * - o laço inicial que é um bicho deixa de ser contato do Agent;
 * - a dívida/pressão é do JOGADOR, não do laço (antes ficava como "pendente" dele).
 */
/** Personalidade padrão do Rafa (campanha nova e saves antigos). */
export const RAFA_PROFILE: NpcProfile = {
  traits: ['cético', 'pragmático', 'paranoico com corpos'],
  voice: 'frases curtas, gíria de rua, chama todo mundo de choom, nunca fala nome de cliente por mensagem',
  motivation: 'juntar eddies para sair do térreo e virar canal de verdade',
  fear: 'virar alvo da Militech por causa de uma carga quente',
  lines: 'nunca entrega um runner para a polícia',
};

export function repairNpcs(state: GameState): GameState {
  const debt = state.character.bio.debtReason?.trim();
  let changed = false;
  const npcs = state.npcs.map(n => {
    // Rafa de saves antigos ganha a personalidade padrão (RAFA_ID; sem importar initialState: evita ciclo).
    if (n.id === 'npc_rafa' && !n.profile) {
      changed = true;
      return { ...n, profile: { ...RAFA_PROFILE, traits: [...RAFA_PROFILE.traits] } };
    }
    if (n.id !== 'npc_family') return n; // FAMILY_ID (sem importar initialState: evita ciclo)
    let next = n;
    if (n.kind === undefined && looksLikeAnimal(`${n.name} ${n.description}`)) next = { ...next, kind: 'animal', isContact: false, role: 'Bicho de estimação' };
    if (debt && next.pendingMatters?.trim() === debt) next = { ...next, pendingMatters: undefined };
    if (next !== n) changed = true;
    return next;
  });
  // A missão inicial era sempre "aluguel", mesmo quando a pressão era outra.
  const missions = state.missions.map(m => (m.id === 'm_rent' && m.title === 'Sobreviver ao Aluguel' && debt && !/aluguel/i.test(debt) ? { ...m, title: 'Pressão imediata', description: debt } : m));
  if (missions.some((m, i) => m !== state.missions[i])) changed = true;
  return changed ? { ...state, npcs, missions } : state;
}

/** Marca um NPC como contato do Agent (cria o NPC se ainda não existir). */
export function saveContact(state: GameState, name: string, reason = 'contato salvo'): { state: GameState; npc: Npc; changed: boolean } {
  const res = ensureNpc(state, name, { isContact: true, role: 'Contato' });
  if (!canUsePhone(res.npc)) return { state, npc: res.npc, changed: false };
  if (res.npc.isContact && !res.created) return { state: res.state, npc: res.npc, changed: false };
  let s = res.state;
  if (!res.created) s = { ...s, npcs: s.npcs.map(n => (n.id === res.npc.id ? { ...n, isContact: true } : n)) };
  s = emit(s, 'NPC_UPDATED', `${res.npc.name}: ${reason} no Agent`, { target: res.npc.id, data: { isContact: true } });
  return { state: s, npc: { ...res.npc, isContact: true }, changed: true };
}

/** O texto fala em salvar/trocar/passar/pegar contato ou número? */
const CONTACT_EXCHANGE = /\b(salv\w*|anot\w*|guard\w*|troc\w*|pass\w*|peg\w*|registr\w*|adicion\w*|add)\b[^.!?\n]{0,60}\b(contatos?|n[uú]meros?|telefones?|canal|agent|zap|holo)\b|\b(contatos?|n[uú]meros?)\b[^.!?\n]{0,40}\b(salv\w*|anotad\w*|trocad\w*)\b/i;

const NAME_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'the', 'minha', 'meu', 'seu', 'sua', 'senhor', 'senhora', 'dona']);

/** NPCs vivos citados no texto (por qualquer parte do nome, inclusive apelido entre aspas). */
export function mentionedNpcs(state: Pick<GameState, 'npcs'>, text: string): Npc[] {
  const words = new Set(normalizeName(text).split(' '));
  return state.npcs.filter(n => {
    if (n.status === 'dead') return false;
    const tokens = normalizeName(n.name)
      .split(' ')
      .filter(t => t.length >= 3 && !NAME_STOPWORDS.has(t));
    return tokens.some(t => words.has(t));
  });
}

/**
 * Rede de segurança: se o JOGADOR diz que salvou/trocou contato com alguém conhecido,
 * o contato é salvo mesmo que o LLM esqueça de chamar a ferramenta.
 */
export function applyContactExchange(state: GameState, playerText: string): { state: GameState; saved: string[] } {
  if (!CONTACT_EXCHANGE.test(playerText)) return { state, saved: [] };
  let s = state;
  const saved: string[] = [];
  for (const npc of mentionedNpcs(s, playerText)) {
    const res = saveContact(s, npc.id);
    s = res.state;
    if (res.changed) saved.push(npc.id);
  }
  return { state: s, saved };
}
