/**
 * Engenharia de contexto: monta dinamicamente só o que é relevante para o turno.
 * SISTEMA (no servidor) + PERSONAGEM + CENA + NPCs RELEVANTES + MISSÕES + MUNDO
 * + MEMÓRIAS RELEVANTES + RESUMOS + HISTÓRICO RECENTE.
 */
import type { ChatEntry, GameState, Npc } from '../types/game';
import type { GameContext } from '../types/gm';
import { getSkill } from '../rules/skills';
import { retrieveMemories } from './memory';
import { turnIdOf } from './events';
import { computeThreat, pendingOffscreen } from './world';

export const RECENT_HISTORY_ENTRIES = 14;
export const MAX_CONTEXT_NPCS = 12;

/** Resumo textual de uma entrada do chat para o histórico enviado ao GM. */
export function summarizeChatEntry(e: ChatEntry): string {
  if (e.kind === 'roll' && e.roll) {
    const r = e.roll;
    const skill = getSkill(r.check.skillId)?.label ?? 'sem perícia';
    let text = `[ROLAGEM] ${r.request.reason} — ${r.check.stat}+${skill}: ${r.check.total} vs DV ${r.check.dv} → ${r.check.success ? 'SUCESSO' : 'FALHA'}`;
    if (r.attack?.failure) text += ` (${r.attack.failure})`;
    if (r.attack?.application) text += ` | dano ${r.attack.application.hpDamage} em ${r.attack.targetName} (PV ${r.attack.application.hpAfter})`;
    if (r.deathSave) text += ` | Teste de Morte ${r.deathSave.success ? 'superado' : 'FALHOU'}`;
    return text;
  }
  return e.text.length > 1200 ? `${e.text.slice(0, 1200)}…` : e.text;
}

/** NPCs relevantes: presentes, citados, com missão ativa, com conversa recente. Mortos só se citados. */
export function relevantNpcs(state: GameState, query: string): Npc[] {
  const q = query.toLowerCase();
  const activeGivers = new Set(state.missions.filter(m => m.status === 'ACTIVE' && m.giverId).map(m => m.giverId));
  const recentThreads = new Set(state.phone.filter(t => t.messages.length).slice(-4).map(t => t.npcId));
  const score = (n: Npc) => {
    const first = n.name.toLowerCase().replace(/["“”]/g, '').split(/\s+/)[0];
    const mentioned = q.includes(n.id) || (first.length > 2 && q.includes(first));
    if (n.status === 'dead') return mentioned ? 5 : -1;
    return (state.scene.presentNpcIds.includes(n.id) ? 10 : 0) + (mentioned ? 8 : 0) + (activeGivers.has(n.id) ? 4 : 0) + (recentThreads.has(n.id) ? 2 : 0) + (n.isContact ? 1 : 0);
  };
  return state.npcs
    .map(n => ({ n, s: score(n) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CONTEXT_NPCS)
    .map(x => x.n);
}

/** Histórico cru APÓS o último resumo (o que é anterior está nos resumos). */
export function recentHistory(state: GameState, max = RECENT_HISTORY_ENTRIES) {
  return state.chat
    .filter(e => e.turn > state.history.summarizedUpToTurn && e.kind !== 'system')
    .slice(-max)
    .map(e => ({ turn: e.turn, kind: e.kind, text: summarizeChatEntry(e) }));
}

export function buildGameContext(state: GameState, query = ''): GameContext {
  const memories = retrieveMemories(state, query || state.world.situation, 8);
  return {
    sessionId: state.id,
    branchId: state.session.branchId,
    turnId: turnIdOf(state),
    turn: state.turn,
    character: state.character,
    world: state.world,
    scene: { ...state.scene, effectiveThreat: computeThreat(state) },
    npcs: relevantNpcs(state, query),
    quests: [...state.missions.filter(m => m.status === 'ACTIVE'), ...state.missions.filter(m => m.status !== 'ACTIVE').slice(-3)],
    factions: state.factions,
    flags: Object.values(state.flags),
    activeEffects: state.activeEffects,
    combat: state.combat,
    net: state.net,
    sandbox: state.sandbox,
    memories,
    summaries: state.history.summaries.slice(-6),
    recentHistory: recentHistory(state),
    phone: state.phone
      .filter(t => t.messages.length)
      .map(t => ({ npcId: t.npcId, npcName: state.npcs.find(n => n.id === t.npcId)?.name ?? t.npcId, last: t.messages.slice(-3).map(m => ({ from: m.from, text: m.text })) })),
    playerKnowledge: state.discoveries.slice(-10).map(d => `${d.title}: ${d.description}`),
    upcoming: state.scheduled.filter(e => e.status === 'scheduled').slice(0, 8).map(e => ({ id: e.id, at: e.at, description: e.description })),
    offscreen: pendingOffscreen(state),
  };
}
