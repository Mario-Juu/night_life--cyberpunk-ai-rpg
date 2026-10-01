/**
 * Condições e execução (golpe de misericórdia).
 *
 * O Cyberpunk RED não tem regra explícita de execução — a morte vem por PV 0 + Testes de Morte.
 * O Cyberpunk 2020 tinha (dano alto na cabeça = morte). Aqui é uma regra da casa, com trava de
 * justiça: o JOGADOR só pode ser executado se estiver indefeso desde um turno anterior
 * (teve ao menos uma chance de reagir). NPCs indefesos podem ser executados na hora.
 */
import type { Character, Combatant, Condition, ConditionKey, GameState, Modifier, Npc } from '../types/game';
import { emit } from './events';
import { setNpcStatus } from './world';

export const CONDITION_KEYS: ConditionKey[] = ['restrained', 'grappled', 'unconscious', 'prone'];

export const CONDITION_LABEL: Record<ConditionKey, string> = {
  restrained: 'Imobilizado',
  grappled: 'Agarrado',
  unconscious: 'Inconsciente',
  prone: 'Caído',
};

export const CONDITION_HINT: Record<ConditionKey, string> = {
  restrained: 'amarrado, algemado, rendido sob a mira — não ataca; pode tentar se soltar',
  grappled: 'preso num agarrão — −2 em todas as ações (Cyberpunk RED)',
  unconscious: 'desacordado — não age',
  prone: 'no chão — levantar custa o movimento',
};

/** Condições que deixam alguém indefeso (sujeito a execução). */
const HELPLESS: ConditionKey[] = ['restrained', 'unconscious'];

export const hasCondition = (list: Condition[] | undefined, key: ConditionKey) => (list ?? []).some(c => c.key === key);

export function setCondition(list: Condition[] | undefined, key: ConditionKey, active: boolean, turn: number, source?: string): Condition[] {
  const rest = (list ?? []).filter(c => c.key !== key);
  if (!active) return rest;
  const prev = (list ?? []).find(c => c.key === key);
  return [...rest, prev ?? { key, sinceTurn: turn, source }];
}

/** Penalidades das condições do jogador: agarrado OU agarrando alguém = −2 em tudo (Cyberpunk RED). */
export function conditionPenalties(c: Character): Modifier[] {
  if (hasCondition(c.conditions, 'grappled')) return [{ label: CONDITION_LABEL.grappled, value: -2 }];
  if (c.grappling) return [{ label: 'Agarrando alguém', value: -2 }];
  return [];
}

/** Combatente impedido de agir: inconsciente ou imobilizado (agarrado só dá −2; caído não impede). */
export function combatantCannotAct(t: { conditions?: Condition[] }): string | null {
  if (hasCondition(t.conditions, 'unconscious')) return 'inconsciente';
  if (hasCondition(t.conditions, 'restrained')) return 'imobilizado';
  return null;
}

/** O jogador não pode atacar enquanto estiver imobilizado ou inconsciente. */
export function playerCannotAct(c: Character): string | null {
  if (hasCondition(c.conditions, 'unconscious')) return 'Você está inconsciente.';
  if (hasCondition(c.conditions, 'restrained')) return 'Você está imobilizado — primeiro tente se soltar, negociar ou ganhar tempo.';
  return null;
}

/**
 * O jogador está indefeso desde um turno ANTERIOR ao atual?
 * (Estabilizado com PV 0 = inconsciente, conforme o RED.)
 */
export function playerHelplessSince(state: GameState): { helpless: boolean; reason: string } {
  const c = state.character;
  const cond = (c.conditions ?? []).find(x => HELPLESS.includes(x.key) && x.sinceTurn < state.turn);
  if (cond) return { helpless: true, reason: CONDITION_LABEL[cond.key].toLowerCase() };
  if (c.hp.current <= 0 && c.stabilized) return { helpless: true, reason: 'inconsciente (estabilizado)' };
  return { helpless: false, reason: '' };
}

/**
 * O jogador pode morrer sem rolagem? Só com aviso prévio (um turno para reagir):
 * - indefeso desde um turno anterior (execução), ou
 * - ameaça letal anunciada num turno anterior e ainda ativa (bomba, Soulkiller, desabamento).
 */
export function playerCanBeKilled(state: GameState): { allowed: boolean; reason: string } {
  const h = playerHelplessSince(state);
  if (h.helpless) return { allowed: true, reason: h.reason };
  const t = state.scene.lethalThreat;
  if (t && t.sinceTurn < state.turn) return { allowed: true, reason: `ameaça letal: ${t.description}` };
  return { allowed: false, reason: '' };
}

export function combatantHelpless(c: Combatant): boolean {
  return c.status === 'down' || c.status === 'surrendered' || HELPLESS.some(k => hasCondition(c.conditions, k));
}

export function npcHelpless(n: Npc): boolean {
  return HELPLESS.some(k => hasCondition(n.conditions, k));
}

/** Morte imediata do jogador (flatline). */
export function killPlayer(state: GameState, cause: string): GameState {
  const c = state.character;
  const s: GameState = { ...state, pendingRoll: null, character: { ...c, hp: { ...c.hp, current: 0 }, dead: true, stabilized: false } };
  return emit(s, 'PLAYER_DIED', `Flatline: ${cause}`, { target: 'player', data: { cause } });
}

/** Morte imediata de um NPC/combatente. Liga combatente ↔ NPC pelo id (foe_x ↔ npc_x) ou nome. */
export function killTarget(state: GameState, target: { combatant?: Combatant; npc?: Npc }, cause: string): GameState {
  let s = state;
  const { combatant, npc } = target;
  if (combatant) {
    s = {
      ...s,
      combat: { ...s.combat, combatants: s.combat.combatants.map(c => (c.id === combatant.id ? { ...c, status: 'dead', hp: { ...c.hp, current: 0 } } : c)) },
    };
  }
  const linked =
    npc ??
    (combatant
      ? s.npcs.find(n => n.id === combatant.id.replace(/^foe_/, 'npc_') || n.name.toLowerCase() === combatant.name.toLowerCase())
      : undefined);
  if (linked && linked.status !== 'dead') return setNpcStatus(s, linked.id, 'dead', cause);
  return emit(s, 'NPC_DIED', `${combatant?.name ?? npc?.name} morreu — ${cause}`, { target: combatant?.id ?? npc?.id });
}
