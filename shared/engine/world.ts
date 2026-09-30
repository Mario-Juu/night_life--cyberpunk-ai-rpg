/**
 * Mundo vivo: flags, relógio, fila de eventos agendados, efeitos temporários e missões ligadas a flags.
 */
import type { FlagValue, GameState, ScheduledEvent, ThreatLevel } from '../types/game';
import { advanceGameTime, formatGameTime, gameDay } from '../rules/world';
import { emit } from './events';
import { makeId } from './ids';
import { operatorPerks } from '../rules/roles';
import { syncWithdrawal } from './withdrawal';

export const FLAG_KEY_RE = /^[a-z0-9_]{2,60}$/;

export function normalizeFlagKey(raw: string): string | null {
  const key = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return FLAG_KEY_RE.test(key) ? key : null;
}

export function getFlag(state: GameState, key: string): FlagValue | undefined {
  return state.flags[key]?.value;
}

export function setFlag(state: GameState, key: string, value: FlagValue, visibility: 'public' | 'hidden' = 'public', reason?: string): GameState {
  const prev = state.flags[key];
  if (prev && prev.value === value && prev.visibility === visibility) return state;
  const next: GameState = { ...state, flags: { ...state.flags, [key]: { key, value, visibility, setTurn: state.turn, reason } } };
  return evaluateQuestFlags(emit(next, 'WORLD_FLAG_CHANGED', `${key} = ${value === true ? 'sim' : value === false ? 'não' : String(value)}${reason ? ` (${reason})` : ''}`, { target: key, value, data: { visibility, previous: prev?.value } }));
}

/** Missões com completeFlag/failFlag se resolvem sozinhas quando a flag fica verdadeira. */
export function evaluateQuestFlags(state: GameState): GameState {
  let s = state;
  for (const m of state.missions) {
    if (m.status !== 'ACTIVE') continue;
    if (m.failFlag && getFlag(s, m.failFlag) === true) s = resolveQuest(s, m.id, 'FAILED', `flag ${m.failFlag}`);
    else if (m.completeFlag && getFlag(s, m.completeFlag) === true) s = resolveQuest(s, m.id, 'COMPLETED', `flag ${m.completeFlag}`);
  }
  return s;
}

/** Conclui/falha uma missão. Conclusão paga rewardEddies uma única vez. */
export function resolveQuest(state: GameState, questId: string, status: 'COMPLETED' | 'FAILED' | 'ABANDONED', reason?: string): GameState {
  const quest = state.missions.find(m => m.id === questId);
  if (!quest || quest.status !== 'ACTIVE') return state;
  let s: GameState = {
    ...state,
    missions: state.missions.map(m => (m.id === questId ? { ...m, status, resolvedTurn: state.turn } : m)),
  };
  if (status === 'COMPLETED') {
    s = emit(s, 'QUEST_COMPLETED', `Missão concluída: ${quest.title}`, { target: quest.id, value: quest.rewardEddies, data: { reason } });
    if (quest.rewardEddies > 0) {
      // Operador (Canal, rank 5+): negocia +20% no pagamento do trabalho.
      const bonus = s.character.bio.role === 'fixer' ? Math.round(quest.rewardEddies * operatorPerks(s.character.roleRank).jobBonus) : 0;
      const paid = quest.rewardEddies + bonus;
      s = { ...s, character: { ...s.character, money: s.character.money + paid } };
      s = emit(s, 'MONEY_CHANGED', `+${paid} €$ (recompensa: ${quest.title}${bonus ? `, +${bonus} negociados pelo Operador` : ''})`, { source: quest.giverId ?? quest.id, value: paid });
    }
  } else {
    s = emit(s, 'QUEST_FAILED', `Missão ${status === 'FAILED' ? 'falhou' : 'abandonada'}: ${quest.title}`, { target: quest.id, data: { reason } });
  }
  const flagKey = `quest_${quest.id.replace(/^m_/, '')}_${status.toLowerCase()}`;
  const normalized = normalizeFlagKey(flagKey);
  if (normalized) s = { ...s, flags: { ...s.flags, [normalized]: { key: normalized, value: true, visibility: 'public', setTurn: s.turn } } };
  return s;
}

function conditionHolds(state: GameState, ev: ScheduledEvent): boolean {
  if (!ev.condition) return true;
  // Flag ausente conta como false.
  return (getFlag(state, ev.condition.flag) ?? false) === ev.condition.equals;
}

/** Dispara eventos agendados cuja hora chegou. Mensagens/flags/status são aplicados na hora. */
export function processScheduledEvents(state: GameState): GameState {
  const now = new Date(state.world.time).getTime();
  let s = state;
  for (const ev of state.scheduled) {
    if (ev.status !== 'scheduled' || new Date(ev.at).getTime() > now) continue;
    if (!conditionHolds(s, ev)) {
      s = { ...s, scheduled: s.scheduled.map(e => (e.id === ev.id ? { ...e, status: 'cancelled', resolvedTurn: s.turn } : e)) };
      s = emit(s, 'EVENT_CANCELLED', `Evento cancelado (condição falsa): ${ev.description}`, { target: ev.id });
      continue;
    }
    const a = ev.action;
    let status: ScheduledEvent['status'] = 'resolved';
    if (a.kind === 'message') {
      s = deliverMessage(s, a.npcId, a.text);
    } else if (a.kind === 'set_flag') {
      s = setFlag(s, a.key, a.value, a.visibility, ev.description);
    } else if (a.kind === 'npc_status') {
      s = setNpcStatus(s, a.npcId, a.status, ev.description);
    } else {
      // Narrativo: fica "triggered" até o narrador incorporá-lo à cena.
      status = 'triggered';
    }
    s = { ...s, scheduled: s.scheduled.map(e => (e.id === ev.id ? { ...e, status, resolvedTurn: status === 'resolved' ? s.turn : undefined } : e)) };
    s = emit(s, 'EVENT_TRIGGERED', ev.description, { target: ev.id, data: { kind: a.kind } });
  }
  return s;
}

/** Eventos narrativos disparados que o narrador ainda não mostrou. */
export function pendingOffscreen(state: GameState): string[] {
  return state.scheduled.filter(e => e.status === 'triggered' && e.action.kind === 'narrative').map(e => (e.action.kind === 'narrative' ? e.action.text : e.description));
}

export function acknowledgeOffscreen(state: GameState): GameState {
  if (!state.scheduled.some(e => e.status === 'triggered')) return state;
  return { ...state, scheduled: state.scheduled.map(e => (e.status === 'triggered' ? { ...e, status: 'resolved', resolvedTurn: state.turn } : e)) };
}

export function scheduleEvent(state: GameState, ev: Omit<ScheduledEvent, 'id' | 'status' | 'createdTurn'>): GameState {
  const full: ScheduledEvent = { ...ev, id: makeId('sched'), status: 'scheduled', createdTurn: state.turn };
  const s = { ...state, scheduled: [...state.scheduled.filter(e => e.status === 'scheduled' || state.turn - (e.resolvedTurn ?? state.turn) < 30), full] };
  return emit(s, 'EVENT_SCHEDULED', `${formatGameTime(ev.at).time}: ${ev.description}`, { target: full.id, data: { at: ev.at, kind: ev.action.kind } });
}

export function deliverMessage(state: GameState, npcId: string, text: string): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  // Mortos e animais não mandam mensagem (vale também para eventos agendados).
  if (!npc || npc.status === 'dead' || npc.kind === 'animal') return state;
  const time = formatGameTime(state.world.time).time;
  const exists = state.phone.some(t => t.npcId === npcId);
  const msg = { id: makeId('pm'), from: 'npc' as const, text, time };
  // As respostas rápidas antigas eram para a mensagem anterior: descarta para não ficarem fora de contexto.
  const phone = exists
    ? state.phone.map(t => (t.npcId === npcId ? { ...t, unread: t.unread + 1, suggestedReplies: [], messages: [...t.messages, msg].slice(-100) } : t))
    : [...state.phone, { npcId, unread: 1, suggestedReplies: [], messages: [msg] }];
  const npcs = npc.isContact ? state.npcs : state.npcs.map(n => (n.id === npcId ? { ...n, isContact: true } : n));
  return emit({ ...state, phone, npcs }, 'MESSAGE_RECEIVED', `SMS de ${npc.name}: ${text.slice(0, 80)}`, { source: npcId });
}

export function setNpcStatus(state: GameState, npcId: string, status: 'alive' | 'missing' | 'dead', reason?: string): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc || npc.status === status) return state;
  let s: GameState = { ...state, npcs: state.npcs.map(n => (n.id === npcId ? { ...n, status } : n)) };
  s = emit(s, status === 'dead' ? 'NPC_DIED' : 'NPC_UPDATED', `${npc.name}: ${status === 'dead' ? 'morreu' : status === 'missing' ? 'desaparecido' : 'vivo'}${reason ? ` — ${reason}` : ''}`, { target: npcId, value: status });
  const key = normalizeFlagKey(`${npcId}_alive`);
  if (key) s = setFlag(s, key, status !== 'dead', 'public', reason);
  // Mortos saem da cena e deixam de ter mensagens agendadas.
  if (status === 'dead') {
    s = {
      ...s,
      scene: { ...s.scene, presentNpcIds: s.scene.presentNpcIds.filter(id => id !== npcId) },
      scheduled: s.scheduled.map(e => (e.status === 'scheduled' && 'npcId' in e.action && e.action.npcId === npcId ? { ...e, status: 'cancelled' as const } : e)),
    };
  }
  return s;
}

/** Avança o relógio: dispara agendados, expira efeitos, recarrega Sorte na virada do dia. */
export function advanceTime(state: GameState, minutes: number): GameState {
  if (minutes <= 0) return state;
  const time = advanceGameTime(state.world.time, minutes);
  const newDay = gameDay(time) !== gameDay(state.world.time);
  let s: GameState = {
    ...state,
    world: { ...state.world, time },
    character: newDay ? { ...state.character, luck: { ...state.character.luck, current: state.character.luck.max } } : state.character,
  };
  s = emit(s, 'TIME_ADVANCED', `+${minutes} min → ${formatGameTime(time).time}`, { value: minutes });

  const now = new Date(time).getTime();
  for (const eff of s.activeEffects) {
    if (eff.expiresAt && new Date(eff.expiresAt).getTime() <= now) {
      s = { ...s, activeEffects: s.activeEffects.filter(e => e.id !== eff.id) };
      s = emit(s, 'EFFECT_EXPIRED', `${eff.name} passou`, { target: eff.id });
    }
  }
  s = syncWithdrawal(s);
  return processScheduledEvents(s);
}

export const THREAT_LABEL: Record<ThreatLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', extreme: 'Extrema' };

/** Ameaça efetiva: combate e calor policial elevam o nível definido pela cena. */
export function computeThreat(state: GameState): ThreatLevel {
  const order: ThreatLevel[] = ['low', 'medium', 'high', 'extreme'];
  let level = order.indexOf(state.scene.threat);
  if (state.combat.active) {
    const foes = state.combat.combatants.filter(c => c.status === 'active').length;
    level = Math.max(level, foes >= 3 || state.character.hp.current <= 0 ? 3 : 2);
  }
  if (state.world.heat >= 4) level = Math.max(level, 1);
  return order[Math.max(0, Math.min(3, level))];
}
