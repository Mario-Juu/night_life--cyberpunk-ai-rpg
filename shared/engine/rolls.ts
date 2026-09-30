import type { GameState, Modifier, RollOutcome, RollRequest } from '../types/game';
import { cryptoRng, type Rng } from './dice';
import { resolveCheck, statValue } from './checks';
import { applyPlayerAttack, getPlayerWeapon, resolvePlayerAttack, rollInitiative } from './combat';
import { WEAPONS } from '../rules/weapons';
import { activeOs } from './cyberBonus';
import { effectPenalties, resolveDeathSave } from './health';

/** Modificadores do pedido + efeitos ativos (penalidades de ferimento vêm do próprio resolveCheck). */
export function requestModifiers(state: GameState, request: RollRequest): Modifier[] {
  return [
    ...(request.modifier ? [{ label: 'Situação', value: request.modifier }] : []),
    ...(request.modifiers ?? []),
    ...effectPenalties(state.activeEffects, request.stat),
  ].filter(m => m.value !== 0);
}

/** Cadência 2 (pistolas leves/médias, facas, punhos, artes marciais): dois ataques por Ação — sem tiro mirado nem rajada. */
export function canRof2(state: GameState, request: RollRequest): boolean {
  if (!request.rof2 || (request.mode && request.mode !== 'single')) return false;
  // Sandevistan: o tempo dilatado dá um ataque extra com qualquer arma (o Apogee, até mirado).
  const os = activeOs(state);
  if (request.aimedHead && !os?.aimedFollowUp) return false;
  if (os?.extraAttack) return true;
  const cls = getPlayerWeapon(state.character, request.weaponId).weapon?.weaponClass ?? 'unarmed';
  return WEAPONS[cls].rof === 2;
}

/**
 * Resolve o pendingRoll atual com o motor. Nunca decide nada pelo LLM:
 * o DV do GM vale para testes; ataques usam balística; Teste de Morte usa BODY.
 */
export function resolveRoll(state: GameState, request: RollRequest, luckSpent: number, rng: Rng = cryptoRng): RollOutcome {
  switch (request.kind) {
    case 'attack': {
      const first = resolvePlayerAttack(state, request, luckSpent, rng);
      if (!canRof2(state, request) || !first.attack || first.attack.failure || first.attack.jammedNow) return first;
      // Cadência 2: o segundo golpe/tiro já vê o estado depois do primeiro.
      const applied = applyPlayerAttack(state, first.attack);
      const after: GameState = { ...state, character: applied.character, combat: applied.combat };
      const alive = after.combat.combatants.find(t => t.id === request.targetId && t.status === 'active') ?? after.combat.combatants.find(t => t.status === 'active');
      if (!alive) return first;
      const followUp = resolvePlayerAttack(after, { ...request, targetId: alive.id, ambush: false }, 0, rng);
      return { ...first, followUp };
    }

    case 'deathSave': {
      const ds = resolveDeathSave(state.character, rng);
      const modifiers: Modifier[] = ds.penalty ? [{ label: 'Penalidade acumulada', value: ds.penalty }] : [];
      return {
        request,
        check: {
          stat: 'BODY',
          statValue: state.character.stats.BODY,
          skillId: null,
          skillValue: 0,
          d10: { rolls: [ds.roll], natural: ds.roll, total: ds.roll, crit: false, fumble: ds.roll === 10 },
          modifiers,
          luckSpent: 0,
          total: ds.roll + ds.penalty,
          dv: ds.target,
          success: ds.success,
          margin: ds.target - (ds.roll + ds.penalty),
        },
        deathSave: { roll: ds.roll, target: ds.target, success: ds.success },
      };
    }

    case 'initiative': {
      const init = rollInitiative(state, rng);
      const ref = statValue(state.character, 'REF');
      return {
        request,
        check: {
          stat: 'REF',
          statValue: ref,
          skillId: null,
          skillValue: 0,
          d10: { rolls: [init.die], natural: init.die, total: init.die, crit: false, fumble: false },
          modifiers: init.modifiers,
          luckSpent: 0,
          total: init.player,
          dv: 0,
          success: true,
          margin: init.player,
        },
        initiative: { player: init.player, enemies: init.enemies },
      };
    }

    case 'check':
    default: {
      const modifiers = requestModifiers(state, request);
      const check = resolveCheck(state.character, { stat: request.stat, skillId: request.skillId, dv: request.dv, modifiers, luckSpent }, rng);
      return { request, check };
    }
  }
}

/** Sorte só pode ser gasta em testes e ataques. */
export function canSpendLuck(request: RollRequest | null): boolean {
  return request?.kind === 'check' || request?.kind === 'attack';
}
