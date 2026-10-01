/**
 * Mundo vivo: flags, relógio, fila de eventos agendados, efeitos temporários e missões ligadas a flags.
 */
import type { FlagValue, GameState, ScheduledEvent, ThreatLevel } from '../types/game';
import { advanceGameTime, formatGameTime, gameDay } from '../rules/world';
import { emit, turnIdOf } from './events';
import { makeId } from './ids';
import { operatorPerks } from '../rules/roles';
import { syncWithdrawal } from './withdrawal';
import { fulfillCyberOrders } from './citySystems';

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
/** Janela (em turnos) em que um pagamento do contratante depois da missão concluída conta como o MESMO. */
export const PAYMENT_WINDOW_TURNS = 3;

export interface Payment {
  id: string;
  turn: number;
  value: number;
  source?: string;
  questId?: string;
  reward?: number;
  offsetIds?: string[];
}

/**
 * Entradas de dinheiro desta linha do tempo a partir de um turno, por origem (recompensa de
 * missão × transferência do narrador). Recompensa "já paga na cena" (valor 0) também conta: ela
 * fecha o pagamento daquele trabalho tanto quanto a que creditou.
 */
export function recentPayments(state: GameState, kind: 'quest_reward' | 'transfer', sinceTurn: number): Payment[] {
  const branch = `${state.id}:${state.session.branchId}:`;
  return state.events
    .filter(e => e.turnId.startsWith(branch) && e.turn >= sinceTurn && e.type === 'MONEY_CHANGED' && (e.data as { kind?: string } | undefined)?.kind === kind && typeof e.value === 'number' && (e.value > 0 || kind === 'quest_reward'))
    .map(e => ({ id: e.id, turn: e.turn, value: e.value as number, source: e.source, ...(e.data as { questId?: string; reward?: number; offsetIds?: string[] }) }));
}

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Uma transferência é o pagamento desta missão? Mesmo valor, ou veio de quem deu o trabalho. */
export function paymentMatchesQuest(state: GameState, quest: { rewardEddies: number; giverId?: string }, payment: { value: number; source?: string }): boolean {
  if (payment.value === quest.rewardEddies) return true;
  const giver = quest.giverId ? state.npcs.find(n => n.id === quest.giverId) : undefined;
  if (!giver || !payment.source) return false;
  const first = norm(giver.name).split(/\s+/)[0];
  return first.length >= 3 && norm(payment.source).includes(first);
}

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
      // O narrador às vezes já "pagou" o trabalho na cena (transfer_money) desde que a missão começou —
      // no mesmo turno ou antes. É o MESMO pagamento: a recompensa só completa o que faltar.
      // (Cada transferência só abate UMA recompensa.)
      const used = new Set(recentPayments(s, 'quest_reward', 0).flatMap(p => p.offsetIds ?? []));
      const advances = recentPayments(s, 'transfer', quest.startedTurn).filter(p => !used.has(p.id) && paymentMatchesQuest(s, quest, p));
      const already = Math.min(quest.rewardEddies, advances.reduce((n, p) => n + p.value, 0));
      const offsetIds = advances.map(p => p.id);
      // Operador (Canal, rank 5+): negocia +20% no pagamento do trabalho.
      const bonus = s.character.bio.role === 'fixer' ? Math.round(quest.rewardEddies * operatorPerks(s.character.roleRank).jobBonus) : 0;
      const paid = quest.rewardEddies - already + bonus;
      if (paid > 0) {
        s = { ...s, character: { ...s.character, money: s.character.money + paid } };
        s = emit(s, 'MONEY_CHANGED', `+${paid} €$ (recompensa: ${quest.title}${bonus ? `, +${bonus} negociados pelo Operador` : ''}${already ? `; €$${already} já pagos na cena` : ''})`, {
          source: quest.giverId ?? quest.id,
          value: paid,
          data: { kind: 'quest_reward', questId: quest.id, reward: quest.rewardEddies, offsetIds },
        });
      } else {
        s = emit(s, 'MONEY_CHANGED', `Recompensa de ${quest.title} já paga na cena (€$${already})`, { source: quest.giverId ?? quest.id, value: 0, data: { kind: 'quest_reward', questId: quest.id, reward: quest.rewardEddies, offsetIds } });
      }
      // Equipe: cada membro leva a parte combinada do trabalho inteiro (o jogador repassa na hora) e fica mais leal.
      for (const m of s.party?.members ?? []) {
        if (s.npcs.find(n => n.id === m.npcId)?.status !== 'alive') continue;
        const cut = Math.min(s.character.money, Math.round(((quest.rewardEddies + bonus) * m.share) / 100));
        if (cut <= 0) continue;
        const name = s.npcs.find(n => n.id === m.npcId)?.name ?? m.npcId;
        s = { ...s, character: { ...s.character, money: s.character.money - cut }, party: { members: (s.party?.members ?? []).map(x => (x.npcId === m.npcId ? { ...x, loyalty: Math.min(100, x.loyalty + 5) } : x)) } };
        s = emit(s, 'MONEY_CHANGED', `−${cut} €$ para ${name} (parte dele: ${m.share}% de ${quest.title})`, { source: 'player', target: m.npcId, value: -cut, data: { kind: 'party_share', questId: quest.id } });
      }
    }
  } else {
    s = emit(s, 'QUEST_FAILED', `Missão ${status === 'FAILED' ? 'falhou' : 'abandonada'}: ${quest.title}`, { target: quest.id, data: { reason } });
  }
  // Trabalho encerrado: o que o contratante "oferecia/queria" sobre ele deixa de valer (senão o narrador paga de novo).
  if (quest.giverId) s = clearStaleGiverState(s, quest);
  const flagKey = `quest_${quest.id.replace(/^m_/, '')}_${status.toLowerCase()}`;
  const normalized = normalizeFlagKey(flagKey);
  if (normalized) s = { ...s, flags: { ...s.flags, [normalized]: { key: normalized, value: true, visibility: 'public', setTurn: s.turn } } };
  return s;
}

const STALE_WORDS = (t: string) => new Set(norm(t).split(/[^a-z0-9]+/).filter(w => w.length >= 5));

/**
 * Limpa pendência e objetivo imediato do contratante que falam DESTE trabalho (mesmas palavras do
 * título/objetivo ou o valor da recompensa). O resto (outros assuntos) fica.
 */
function clearStaleGiverState(state: GameState, quest: { title: string; objective: string; rewardEddies: number; giverId?: string }): GameState {
  const giver = state.npcs.find(n => n.id === quest.giverId);
  if (!giver) return state;
  const words = STALE_WORDS(`${quest.title} ${quest.objective}`);
  const aboutJob = (t?: string) => !!t && ((quest.rewardEddies > 0 && norm(t).replace(/[.\s]/g, '').includes(String(quest.rewardEddies))) || [...STALE_WORDS(t)].some(w => words.has(w)));
  const pending = aboutJob(giver.pendingMatters);
  const goal = aboutJob(giver.currentGoal);
  if (!pending && !goal) return state;
  const next = { ...giver, pendingMatters: pending ? undefined : giver.pendingMatters, ...(goal ? { currentGoal: undefined, currentGoalKnown: undefined } : {}) };
  return emit({ ...state, npcs: state.npcs.map(n => (n.id === giver.id ? next : n)) }, 'NPC_UPDATED', `${giver.name}: trabalho "${quest.title}" encerrado`, { target: giver.id });
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
  const npcs = npc.isContact && !npc.offstage ? state.npcs : state.npcs.map(n => (n.id === npcId ? { ...n, isContact: true, offstage: undefined } : n));
  return emit({ ...state, phone, npcs }, 'MESSAGE_RECEIVED', `SMS de ${npc.name}: ${text.slice(0, 80)}`, { source: npcId });
}

export function setNpcStatus(state: GameState, npcId: string, status: 'alive' | 'missing' | 'dead', reason?: string): GameState {
  const npc = state.npcs.find(n => n.id === npcId);
  if (!npc || npc.status === status) return state;
  // Morte é permanente: nada (nem evento agendado, nem frente) traz alguém de volta.
  if (npc.status === 'dead') return state;
  let s: GameState = { ...state, npcs: state.npcs.map(n => (n.id === npcId ? { ...n, status } : n)) };
  s = emit(s, status === 'dead' ? 'NPC_DIED' : 'NPC_UPDATED', `${npc.name}: ${status === 'dead' ? 'morreu' : status === 'missing' ? 'desaparecido' : 'vivo'}${reason ? ` — ${reason}` : ''}`, { target: npcId, value: status });
  const key = normalizeFlagKey(`${npcId}_alive`);
  if (key) s = setFlag(s, key, status !== 'dead', 'public', reason);
  // Quem morre ou some deixa a equipe (e para de receber parte dos trabalhos).
  if (status !== 'alive' && s.party?.members.some(m => m.npcId === npcId)) {
    s = { ...s, party: { members: s.party.members.filter(m => m.npcId !== npcId) } };
    s = emit(s, 'NPC_UPDATED', `${npc.name} deixou a equipe (${status === 'dead' ? 'morreu' : 'desapareceu'})`, { target: npcId, data: { party: 'leave' } });
    // Sai da luta também.
    s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(t => (t.npcId === npcId && t.status === 'active' ? { ...t, status: 'fled' as const } : t)) } };
  }
  // Quem não está mais vivo sai da cena; mortos deixam de ter mensagens agendadas.
  if (status !== 'alive') s = { ...s, scene: { ...s.scene, presentNpcIds: s.scene.presentNpcIds.filter(id => id !== npcId) } };
  if (status === 'dead') {
    s = { ...s, scheduled: s.scheduled.map(e => (e.status === 'scheduled' && 'npcId' in e.action && e.action.npcId === npcId ? { ...e, status: 'cancelled' as const } : e)) };
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
  // Fora de combate o deck descansa: RAM dos quickhacks enche.
  const ram = s.character.deck?.ram;
  if (ram && !s.combat.active && ram.current < ram.max) s = { ...s, character: { ...s.character, deck: { ...s.character.deck!, ram: { ...ram, current: ram.max } } } };
  s = syncWithdrawal(s);
  s = fulfillCyberOrders(processScheduledEvents(s));
  if (s.world.market?.endsAt && new Date(s.world.market.endsAt).getTime() <= new Date(s.world.time).getTime()) {
    const market = s.world.market;
    s = emit({ ...s, world: { ...s.world, market: undefined } }, 'SCENE_CHANGED', `Mercado Noturno encerrou: ${market.name}`, { target: market.id, data: { nightMarket: 'closed' } });
  }
  return s;
}

export const THREAT_LABEL: Record<ThreatLevel, string> = { low: 'Baixa', medium: 'Média', high: 'Alta', extreme: 'Extrema' };

/** Ameaça efetiva: combate e calor policial elevam o nível definido pela cena. */
export function computeThreat(state: GameState): ThreatLevel {
  const order: ThreatLevel[] = ['low', 'medium', 'high', 'extreme'];
  let level = order.indexOf(state.scene.threat);
  if (state.combat.active) {
    const foes = state.combat.combatants.filter(c => c.status === 'active' && c.side !== 'ally').length;
    level = Math.max(level, foes >= 3 || state.character.hp.current <= 0 ? 3 : 2);
  }
  if (state.world.heat >= 4) level = Math.max(level, 1);
  return order[Math.max(0, Math.min(3, level))];
}
