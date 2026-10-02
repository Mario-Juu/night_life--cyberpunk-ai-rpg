/**
 * Engenharia de contexto: monta dinamicamente só o que é relevante para o turno.
 * SISTEMA (no servidor) + PERSONAGEM + CENA + NPCs RELEVANTES + MISSÕES + MUNDO
 * + MEMÓRIAS RELEVANTES + RESUMOS + HISTÓRICO RECENTE.
 */
import type { ChatEntry, Front, GameState, Npc } from '../types/game';
import type { GameContext } from '../types/gm';
import { getSkill } from '../rules/skills';
import { memoryLinked, mentionsName, retrieveMemories } from './memory';
import { turnIdOf } from './events';
import { computeThreat, pendingOffscreen } from './world';
import { continuationOf } from './fronts';
import { STANCE_LABEL } from './party';

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
    // Palavra inteira: "Rafael" não puxa a Rafa, "banana" não puxa a Ana.
    const mentioned = q.includes(n.id) || mentionsName(q, first) || mentionsName(q, n.name);
    if (n.status === 'dead') return mentioned ? 5 : -1;
    // Rosto/vítima de trama que o jogador ainda não conheceu: só entra se for citado.
    if (n.offstage) return mentioned ? 8 : -1;
    return (state.party?.members.some(m => m.npcId === n.id) ? 9 : 0) + (state.scene.presentNpcIds.includes(n.id) ? 10 : 0) + (mentioned ? 8 : 0) + (activeGivers.has(n.id) ? 4 : 0) + (recentThreads.has(n.id) ? 2 : 0) + (n.isContact ? 1 : 0);
  };
  return state.npcs
    .map(n => ({ n, s: score(n) }))
    // Nota 0 = sem nada que o ligue a este turno (não está aqui, não foi citado, não é contato,
    // não deu missão). Entrava assim mesmo, com perfil e segredos, e gente de outra história
    // virava "relevante" — o Mestre a costurava na cena.
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, MAX_CONTEXT_NPCS)
    .map(x => x.n);
}

/**
 * Por que esta trama toca a cena de agora (rosto/vítima presente ou citado, o grupo dela no lugar,
 * na rede ou na fala do jogador). Sem motivo concreto → undefined: a trama é de OUTRO lugar, e o
 * Mestre não deve ligá-la ao que está aqui só porque "também é um hotel".
 */
export function frontSceneLink(state: GameState, f: Front, query = ''): string | undefined {
  const present = state.scene.presentNpcIds;
  for (const id of [f.seedNpcId, f.victimNpcId]) {
    const n = id ? state.npcs.find(x => x.id === id) : undefined;
    if (!n) continue;
    if (present.includes(n.id)) return `${n.name} está na cena`;
    if (mentionsName(query, n.name) || mentionsName(query, n.name.split(/\s+/)[0])) return `o jogador citou ${n.name}`;
  }
  const faction = state.factions.find(x => x.id === f.factionId);
  const group = [f.who, faction?.name].filter((g): g is string => !!g && g.length > 2);
  const presentGroup = state.npcs.find(n => present.includes(n.id) && n.faction && group.some(g => mentionsName(n.faction!, g) || n.faction === f.factionId));
  if (presentGroup) return `${presentGroup.name} (${presentGroup.faction}) está na cena`;
  const l = state.world.location;
  const here = [l.spot, l.subDistrict, state.scene.description, state.net?.architecture?.name ?? ''].join(' · ');
  const g = group.find(x => mentionsName(here, x));
  if (g) return `${g} aparece no lugar/rede atual`;
  const said = group.find(x => mentionsName(query, x));
  if (said) return `o jogador citou ${said}`;
  return undefined;
}

/** Histórico cru APÓS o último resumo (o que é anterior está nos resumos). */
export function recentHistory(state: GameState, max = RECENT_HISTORY_ENTRIES) {
  return state.chat
    .filter(e => e.turn > state.history.summarizedUpToTurn && e.kind !== 'system')
    .slice(-max)
    .map(e => ({ turn: e.turn, kind: e.kind, text: summarizeChatEntry(e) }));
}

/** Limite de combatentes que o servidor aceita no contexto (server/validation.ts). */
export const MAX_CONTEXT_COMBATANTS = 16;

/**
 * Combate enxuto para o Mestre: todo mundo de pé primeiro; corpos/fugidos só preenchem o que sobrar
 * (os mais recentes). Sem isso, uma luta grande + corpos antigos estoura o limite do servidor e o
 * jogo trava em "Requisição inválida" até o próximo combate.
 */
export function combatForContext(combat: GameState['combat']): GameState['combat'] {
  if (combat.combatants.length <= MAX_CONTEXT_COMBATANTS) return combat;
  const standing = combat.combatants.filter(c => c.status === 'active');
  const rest = combat.combatants.filter(c => c.status !== 'active').slice(-Math.max(0, MAX_CONTEXT_COMBATANTS - standing.length));
  return { ...combat, combatants: [...standing.slice(0, MAX_CONTEXT_COMBATANTS), ...rest] };
}

export function buildGameContext(state: GameState, query = ''): GameContext {
  const memories = retrieveMemories(state, query || state.world.situation, 8).map(m => ({ ...m, linked: memoryLinked(state, m, query) }));
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
    combat: combatForContext(state.combat),
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
    fronts: [...(state.fronts ?? []).filter(f => f.status === 'active'), ...(state.fronts ?? []).filter(f => f.status !== 'active').slice(-2)].map(f => ({
      id: f.id,
      title: f.title,
      premise: f.premise,
      who: f.who,
      place: f.place,
      motive: f.motive,
      victim: f.victim,
      twist: f.twist,
      status: f.status,
      playerAware: f.playerAware,
      stage: f.stage,
      total: f.stages.length,
      done: f.stages.slice(0, f.stage).map(st => st.title),
      next: f.status === 'active' && f.stages[f.stage] ? { title: f.stages[f.stage].title, at: f.nextAt, blockHint: f.stages[f.stage].blockHint } : undefined,
      seedNpc: state.npcs.find(n => n.id === f.seedNpcId)?.name,
      continues: continuationOf(state, f),
      sceneLink: frontSceneLink(state, f, query),
    })),
    news: (state.news ?? []).slice(-6).map(n => ({ source: n.source, headline: n.headline, at: n.at })),
    party: (state.party?.members ?? []).map(m => {
      const n = state.npcs.find(x => x.id === m.npcId);
      return { npcId: m.npcId, name: n?.name ?? m.npcId, share: m.share, loyalty: m.loyalty, stance: STANCE_LABEL[m.stance], hp: n?.combat ? `${n.combat.hp.current}/${n.combat.hp.max}` : '?', present: state.scene.presentNpcIds.includes(m.npcId) };
    }),
  };
}
