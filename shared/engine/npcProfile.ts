/**
 * Profundidade dos NPCs: personalidade, objetivos de longo prazo, vínculos e o que o JOGADOR sabe
 * de cada coisa. A consciência do jogador só muda por aqui (revealNpcItem), sempre registrada.
 */
import type { Awareness, GameState, Npc, NpcBond, NpcBondKind, NpcGoal, NpcGoalStatus, NpcImportance, NpcKnowledge, NpcProfile } from '../types/game';
import type { NpcProfileRequest, NpcProfileResponse } from '../types/gm';
import { emit } from './events';
import { makeId } from './ids';

export const NPC_BOND_KINDS: readonly NpcBondKind[] = ['aliado', 'rival', 'deve_a', 'cobra', 'familia', 'amante', 'chefe', 'subordinado', 'ex'];
export const BOND_LABEL: Record<NpcBondKind, string> = {
  aliado: 'aliado de',
  rival: 'rival de',
  deve_a: 'deve a',
  cobra: 'cobra',
  familia: 'família de',
  amante: 'amante de',
  chefe: 'chefe de',
  subordinado: 'trabalha para',
  ex: 'ex de',
};

const MAX_TRAITS = 5;
const MAX_GOALS = 5;
const MAX_BONDS = 8;
const MAX_FACTS = 12;

/** Saves antigos não têm `playerKnows`: segredo = não sabe; fato comum = sabe. */
export function factAwareness(k: NpcKnowledge): Awareness {
  return k.playerKnows ?? (k.secret ? 'no' : 'yes');
}

const RANK: Record<Awareness, number> = { no: 0, suspects: 1, yes: 2 };

function replaceNpc(state: GameState, npc: Npc): GameState {
  return { ...state, npcs: state.npcs.map(n => (n.id === npc.id ? npc : n)) };
}

/** Mescla a personalidade (campos ausentes ficam como estavam). Traços aceitam lista ou texto "a, b, c". */
export function mergeProfile(current: NpcProfile | undefined, patch: Partial<Omit<NpcProfile, 'traits'>> & { traits?: string[] | string }): NpcProfile {
  const raw = typeof patch.traits === 'string' ? patch.traits.split(/[,;]/) : (patch.traits ?? []);
  const traits = raw.map(t => t.trim().toLowerCase()).filter(Boolean);
  const pick = (v: string | undefined, old: string | undefined) => (v?.trim() ? v.trim() : old);
  return {
    traits: traits.length ? [...new Set(traits)].slice(0, MAX_TRAITS) : (current?.traits ?? []),
    voice: pick(patch.voice, current?.voice),
    motivation: pick(patch.motivation, current?.motivation),
    fear: pick(patch.fear, current?.fear),
    lines: pick(patch.lines, current?.lines),
  };
}

export function setNpcProfile(state: GameState, npcId: string, patch: Parameters<typeof mergeProfile>[1]): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc) return state;
  const profile = mergeProfile(npc.profile, patch);
  return emit(replaceNpc(state, { ...npc, profile }), 'NPC_UPDATED', `${npc.name}: personalidade definida (${profile.traits.join(', ') || 'sem traços'})`, { target: npc.id, data: { profile: true } });
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Cria ou atualiza um objetivo de longo prazo (por id ou pelo mesmo texto). */
export function upsertNpcGoal(
  state: GameState,
  npcId: string,
  input: { goalId?: string; text?: string; status?: NpcGoalStatus; playerKnows?: Awareness },
): { state: GameState; goal: NpcGoal } | { error: string } {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc) return { error: `NPC "${npcId}" não existe.` };
  const goals = npc.goals ?? [];
  const existing = goals.find(g => g.id === input.goalId) ?? (input.text ? goals.find(g => sameText(g.text, input.text!)) : undefined);
  if (!existing && !input.text?.trim()) return { error: input.goalId ? `Objetivo "${input.goalId}" não existe em ${npc.name}.` : 'Informe o texto do objetivo.' };
  const goal: NpcGoal = existing
    ? {
        ...existing,
        text: input.text?.trim() || existing.text,
        status: input.status ?? existing.status,
        // A consciência do jogador só sobe por aqui; para revelar, use revealNpcItem (fica registrado como).
        playerKnows: input.playerKnows && RANK[input.playerKnows] > RANK[existing.playerKnows] ? input.playerKnows : existing.playerKnows,
      }
    : { id: makeId('goal'), text: input.text!.trim(), status: input.status ?? 'active', playerKnows: input.playerKnows ?? 'no' };
  // Concluídos/abandonados saem primeiro quando a lista enche.
  const next = existing ? goals.map(g => (g.id === goal.id ? goal : g)) : [...goals, goal];
  const trimmed = next.length > MAX_GOALS ? [...next.filter(g => g.status === 'active'), ...next.filter(g => g.status !== 'active')].slice(0, MAX_GOALS) : next;
  const verb = existing ? (input.status && input.status !== existing.status ? (input.status === 'done' ? 'conseguiu' : input.status === 'dropped' ? 'desistiu de' : 'retomou') : 'ajustou') : 'quer';
  const s = emit(replaceNpc(state, { ...npc, goals: trimmed }), 'NPC_UPDATED', `${npc.name} ${verb}: ${goal.text}`, { target: npc.id, data: { goalId: goal.id, status: goal.status } });
  return { state: s, goal };
}

/** Cria ou atualiza um vínculo (o mesmo alvo + tipo é o mesmo vínculo). */
export function upsertNpcBond(
  state: GameState,
  npcId: string,
  input: { targetId: string; kind: NpcBondKind; note?: string; playerKnows?: Awareness },
): { state: GameState; bond: NpcBond } | { error: string } {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc) return { error: `NPC "${npcId}" não existe.` };
  if (input.targetId === npc.id) return { error: 'Um NPC não tem vínculo consigo mesmo.' };
  const bonds = npc.bonds ?? [];
  const existing = bonds.find(b => b.targetId === input.targetId && b.kind === input.kind);
  const bond: NpcBond = existing
    ? { ...existing, note: input.note?.trim() || existing.note, playerKnows: input.playerKnows && RANK[input.playerKnows] > RANK[existing.playerKnows] ? input.playerKnows : existing.playerKnows }
    : { id: makeId('bond'), targetId: input.targetId, kind: input.kind, note: input.note?.trim() || undefined, playerKnows: input.playerKnows ?? 'no' };
  const next = (existing ? bonds.map(b => (b.id === bond.id ? bond : b)) : [...bonds, bond]).slice(-MAX_BONDS);
  const s = emit(replaceNpc(state, { ...npc, bonds: next }), 'NPC_UPDATED', `${npc.name} ${BOND_LABEL[bond.kind]} ${targetName(state, bond.targetId)}`, { target: npc.id, data: { bondId: bond.id } });
  return { state: s, bond };
}

/** Acrescenta um fato/segredo (sem duplicar o mesmo texto). */
export function addNpcFact(state: GameState, npcId: string, fact: string, secret: boolean, weight?: 1 | 2 | 3): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc || !fact.trim() || npc.knowledge.some(k => sameText(k.fact, fact))) return state;
  const k: NpcKnowledge = { id: makeId('fact'), fact: fact.trim(), secret, playerKnows: secret ? 'no' : 'yes', ...(weight ? { weight } : {}) };
  return replaceNpc(state, { ...npc, knowledge: [...npc.knowledge, k].slice(-MAX_FACTS) });
}

export function targetName(state: Pick<GameState, 'npcs' | 'factions'>, id: string): string {
  return state.npcs.find(n => n.id === id)?.name ?? state.factions.find(f => f.id === id)?.name ?? id;
}

/** Acha fato, objetivo ou vínculo pelo id; também aceita "current_goal" (objetivo imediato). */
function findItem(state: GameState, npc: Npc, itemId: string): { kind: 'fact' | 'goal' | 'bond' | 'current'; text: string; awareness: Awareness } | null {
  if (itemId === 'current_goal') return npc.currentGoal ? { kind: 'current', text: npc.currentGoal, awareness: npc.currentGoalKnown ? 'yes' : 'no' } : null;
  const k = npc.knowledge.find(x => x.id === itemId);
  if (k) return { kind: 'fact', text: k.fact, awareness: factAwareness(k) };
  const g = npc.goals?.find(x => x.id === itemId);
  if (g) return { kind: 'goal', text: g.text, awareness: g.playerKnows };
  const b = npc.bonds?.find(x => x.id === itemId);
  if (b) return { kind: 'bond', text: `${npc.name} ${BOND_LABEL[b.kind]} ${targetName(state, b.targetId)}`, awareness: b.playerKnows };
  return null;
}

/**
 * O jogador descobre (level 'yes') ou passa a desconfiar ('suspects') de um segredo, objetivo ou vínculo.
 * Nunca desce (quem já sabe não "desaprende").
 */
export function revealNpcItem(state: GameState, npcId: string, itemId: string, level: 'suspects' | 'yes', how?: string): { state: GameState; text: string } | { error: string } {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc) return { error: `NPC "${npcId}" não existe.` };
  const item = findItem(state, npc, itemId);
  if (!item) return { error: `${npc.name} não tem o item "${itemId}". Use um id listado no contexto (fact_…, goal_…, bond_… ou current_goal).` };
  if (RANK[item.awareness] >= RANK[level]) return { error: `O jogador já ${item.awareness === 'yes' ? 'sabe' : 'desconfia'} disso.` };
  const turn = state.turn;
  let next: Npc = npc;
  if (item.kind === 'current') next = { ...npc, currentGoalKnown: level === 'yes' ? true : npc.currentGoalKnown };
  else if (item.kind === 'fact')
    next = { ...npc, knowledge: npc.knowledge.map(k => (k.id === itemId ? { ...k, playerKnows: level, ...(level === 'yes' ? { revealedTurn: turn, revealedHow: how?.trim() || undefined } : {}) } : k)) };
  else if (item.kind === 'goal') next = { ...npc, goals: npc.goals!.map(g => (g.id === itemId ? { ...g, playerKnows: level } : g)) };
  else next = { ...npc, bonds: npc.bonds!.map(b => (b.id === itemId ? { ...b, playerKnows: level } : b)) };
  const text = item.text;
  const summary = `${level === 'yes' ? 'Descobriu' : 'Desconfia'} sobre ${npc.name}: ${text}${how ? ` (${how})` : ''}`;
  const s = emit(replaceNpc(state, next), 'NPC_UPDATED', summary, { target: npc.id, data: { reveal: itemId, level } });
  return { state: s, text };
}

/** O que o JOGADOR sabe de um NPC (base do Diário → Pessoas). */
export interface NpcPlayerView {
  traits: string[];
  currentGoal?: string;
  goals: Array<{ text: string; status: NpcGoalStatus; suspected: boolean }>;
  facts: Array<{ text: string; secret: boolean; suspected: boolean; how?: string }>;
  bonds: Array<{ text: string; suspected: boolean }>;
}

export function playerViewOf(state: Pick<GameState, 'npcs' | 'factions'>, npc: Npc): NpcPlayerView {
  const known = (a: Awareness) => a !== 'no';
  return {
    traits: npc.profile?.traits ?? [],
    currentGoal: npc.currentGoalKnown ? npc.currentGoal : undefined,
    goals: (npc.goals ?? []).filter(g => known(g.playerKnows)).map(g => ({ text: g.text, status: g.status, suspected: g.playerKnows === 'suspects' })),
    facts: npc.knowledge
      .filter(k => known(factAwareness(k)))
      .map(k => ({ text: k.fact, secret: k.secret, suspected: factAwareness(k) === 'suspects', how: k.revealedHow })),
    bonds: (npc.bonds ?? [])
      .filter(b => known(b.playerKnows))
      .map(b => ({ text: `${BOND_LABEL[b.kind]} ${targetName(state, b.targetId)}${b.note ? ` — ${b.note}` : ''}`, suspected: b.playerKnows === 'suspects' })),
  };
}

// ---------------------------------------------------------------- importância

const IMPORTANCE_RANK: Record<NpcImportance, number> = { extra: 0, recurring: 1, core: 2 };
/** Interações (turnos distintos) para virar recorrente / central. */
export const RECURRING_AFTER = 2;
export const CORE_AFTER = 6;
/** Depois de uma falha, o perfil só é pedido de novo após estes turnos. */
export const PROFILE_RETRY_TURNS = 10;

/** Laços fixos da campanha (ids de initialState; sem importar: evita ciclo). */
const BORN_CORE = new Set(['npc_rafa', 'npc_family']);

/** Marca que o NPC interagiu neste turno (conta uma vez por turno). */
export function noteInteraction(state: GameState, npcIds: string[]): GameState {
  const ids = new Set(npcIds);
  if (!state.npcs.some(n => ids.has(n.id) && n.lastSeenTurn !== state.turn)) return state;
  return {
    ...state,
    // Interagiu: deixa de estar "fora de cena" (aparece no Diário).
    npcs: state.npcs.map(n => (ids.has(n.id) && n.lastSeenTurn !== state.turn ? { ...n, interactions: (n.interactions ?? 0) + 1, lastSeenTurn: state.turn, offstage: undefined } : n)),
  };
}

/** Importância que o NPC já merece pelo que aconteceu (sem rebaixar a atual). */
export function earnedImportance(state: Pick<GameState, 'missions' | 'phone'>, npc: Npc): NpcImportance {
  const current = npc.importance ?? 'extra';
  if (npc.kind === 'animal') return current;
  const n = npc.interactions ?? 0;
  const giver = state.missions.some(m => m.giverId === npc.id);
  const earned: NpcImportance =
    BORN_CORE.has(npc.id) || giver || n >= CORE_AFTER
      ? 'core'
      : n >= RECURRING_AFTER || npc.isContact || state.phone.some(t => t.npcId === npc.id && t.messages.length)
        ? 'recurring'
        : 'extra';
  return IMPORTANCE_RANK[earned] > IMPORTANCE_RANK[current] ? earned : current;
}

/** Sobe a importância de quem merece (nunca rebaixa) e registra a promoção. */
export function syncImportance(state: GameState): GameState {
  let s = state;
  for (const npc of state.npcs) {
    if (npc.status === 'dead') continue;
    const next = earnedImportance(s, npc);
    if (next === (npc.importance ?? 'extra')) continue;
    s = replaceNpc(s, { ...npc, importance: next });
    s = emit(s, 'NPC_UPDATED', `${npc.name} ganhou importância na história (${next === 'core' ? 'central' : 'recorrente'})`, { target: npc.id, data: { importance: next } });
  }
  return s;
}

/** O que falta para o NPC não ser casca vazia: personalidade (recorrente+) e objetivo/segredo (central). */
export function depthNeeds(npc: Npc): { profile: boolean; depth: boolean } {
  const imp = npc.importance ?? 'extra';
  if (imp === 'extra' || npc.kind === 'animal' || npc.status === 'dead') return { profile: false, depth: false };
  const hasDepth = (npc.goals ?? []).some(g => g.status === 'active') || npc.knowledge.some(k => k.secret);
  return { profile: !npc.profile?.traits.length, depth: imp === 'core' && !hasDepth };
}

/** Próximo NPC a ganhar perfil (central primeiro; quem falhou há pouco espera). */
export function nextProfileCandidate(state: GameState): Npc | undefined {
  return state.npcs
    .filter(n => {
      const need = depthNeeds(n);
      return (need.profile || need.depth) && (n.profileTriedTurn === undefined || state.turn - n.profileTriedTurn >= PROFILE_RETRY_TURNS);
    })
    .sort((a, b) => IMPORTANCE_RANK[b.importance ?? 'extra'] - IMPORTANCE_RANK[a.importance ?? 'extra'] || (b.interactions ?? 0) - (a.interactions ?? 0))[0];
}

export function markProfileTried(state: GameState, npcId: string): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  return npc ? replaceNpc(state, { ...npc, profileTriedTurn: state.turn }) : state;
}

/** Fatos sobre o jogador que o NPC passa a saber (sem duplicar). */
export function addKnowsAboutPlayer(state: GameState, npcId: string, facts: string[]): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  const fresh = facts.map(f => f.trim()).filter(f => f && !(npc?.knowsAboutPlayer ?? []).some(k => sameText(k, f)));
  if (!npc || !fresh.length) return state;
  return emit(replaceNpc(state, { ...npc, knowsAboutPlayer: [...(npc.knowsAboutPlayer ?? []), ...fresh].slice(-8) }), 'NPC_UPDATED', `${npc.name} agora sabe: ${fresh.join('; ')}`, { target: npc.id });
}

/** Evidência do NPC para o Mestre montar o perfil: cenas, mensagens, memórias e eventos. */
export function buildProfileRequest(state: GameState, npcId: string): NpcProfileRequest | null {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc) return null;
  const need = depthNeeds(npc);
  const first = npc.name.toLowerCase().replace(/["“”']/g, '').split(/\s+/)[0];
  const scenes = state.chat
    .filter(e => e.kind === 'narration' && first.length >= 3 && e.text.toLowerCase().includes(first))
    .slice(-6)
    .map(e => `CENA (t${e.turn}): ${e.text.slice(0, 900)}`);
  const sms = (state.phone.find(t => t.npcId === npc.id)?.messages ?? []).slice(-8).map(m => `SMS ${m.from === 'npc' ? npc.name : 'JOGADOR'}: ${m.text}`);
  const memories = state.memories.filter(m => m.subject === npc.id).slice(-5).map(m => `MEMÓRIA: ${m.content}`);
  const events = state.events.filter(e => e.target === npc.id || e.source === npc.id).slice(-8).map(e => `EVENTO (t${e.turn}): ${e.summary}`);
  const bio = state.character.bio;
  return {
    sessionId: state.id,
    turnId: `${state.id}:${state.session.branchId}:t${state.turn}`,
    npc: { id: npc.id, name: npc.name, role: npc.role, description: npc.description, currentGoal: npc.currentGoal, faction: npc.faction, importance: npc.importance ?? 'extra', profile: npc.profile },
    needs: need.profile && need.depth ? 'both' : need.depth ? 'depth' : 'profile',
    evidence: [...scenes, ...sms, ...memories, ...events].join('\n').slice(0, 9000),
    player: { handle: bio.handle, role: bio.role, district: bio.district, occupation: bio.occupation, debtReason: bio.debtReason, familyTie: bio.familyTie },
    others: [
      ...state.npcs.filter(n => n.id !== npc.id && n.status !== 'dead').slice(-20).map(n => ({ id: n.id, name: n.name, role: n.role })),
      ...state.factions.map(f => ({ id: f.id, name: f.name, role: f.category })),
    ],
  };
}

/** Corta no limite sem partir palavra ("…apesar do jaleco im" vira "…apesar do jaleco"). */
const clip = (v: unknown, max: number) => {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const t = v.trim();
  return t.length <= max ? t : t.slice(0, max).replace(/\s+\S*$/, '');
};

/** Aplica o perfil gerado pelo Mestre (tudo validado; campo ruim é ignorado e não derruba o resto). */
export function applyGeneratedProfile(state: GameState, npcId: string, p: NpcProfileResponse): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc || npc.status === 'dead') return state;
  let s = markProfileTried(state, npcId);
  const need = depthNeeds(npc);
  const traits = (Array.isArray(p.traits) ? p.traits : []).map(t => clip(t, 60)).filter((t): t is string => !!t);
  // Perfil que o narrador já definiu não é sobrescrito pela geração em segundo plano.
  if (need.profile && traits.length)
    s = setNpcProfile(s, npcId, { traits, voice: clip(p.voice, 200), motivation: clip(p.motivation, 200), fear: clip(p.fear, 160), lines: clip(p.lines, 200) });
  if (need.depth) {
    const goal = clip(p.goal, 200);
    if (goal) {
      const res = upsertNpcGoal(s, npcId, { text: goal });
      if (!('error' in res)) s = res.state;
    }
    const secret = clip(p.secret, 300);
    const weight = p.secretWeight === 1 || p.secretWeight === 2 || p.secretWeight === 3 ? p.secretWeight : 2;
    if (secret) s = addNpcFact(s, npcId, secret, true, weight);
  }
  const bond = p.bond;
  if (bond && typeof bond.targetId === 'string' && NPC_BOND_KINDS.includes(bond.kind as NpcBondKind)) {
    const target = s.npcs.find(n => n.id === bond.targetId && n.id !== npcId)?.id ?? s.factions.find(f => f.id === bond.targetId)?.id;
    if (target) {
      const res = upsertNpcBond(s, npcId, { targetId: target, kind: bond.kind as NpcBondKind, note: clip(bond.note, 160) });
      if (!('error' in res)) s = res.state;
    }
  }
  if (Array.isArray(p.knowsAboutPlayer))
    s = addKnowsAboutPlayer(
      s,
      npcId,
      p.knowsAboutPlayer
        .map(f => clip(f, 200))
        .filter((f): f is string => !!f)
        .slice(0, 3),
    );
  return s;
}
