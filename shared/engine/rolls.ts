import type { GameState, Modifier, RollOutcome, RollRequest } from '../types/game';
import { cryptoRng, type Rng } from './dice';
import { resolveCheck, statValue } from './checks';
import { resolvePlayerAttack, rollInitiative } from './combat';
import { effectPenalties, resolveDeathSave } from './health';

/** Modificadores do pedido + efeitos ativos (penalidades de ferimento vêm do próprio resolveCheck). */
export function requestModifiers(state: GameState, request: RollRequest): Modifier[] {
  return [
    ...(request.modifier ? [{ label: 'Situação', value: request.modifier }] : []),
    ...(request.modifiers ?? []),
    ...effectPenalties(state.activeEffects, request.stat),
  ].filter(m => m.value !== 0);
}

/**
 * Resolve o pendingRoll atual com o motor. Nunca decide nada pelo LLM:
 * o DV do GM vale para testes; ataques usam balística; Teste de Morte usa BODY.
 */
export function resolveRoll(state: GameState, request: RollRequest, luckSpent: number, rng: Rng = cryptoRng): RollOutcome {
  switch (request.kind) {
    case 'attack':
      return resolvePlayerAttack(state, request, luckSpent, rng);

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
          d10: { rolls: [init.player - ref], natural: init.player - ref, total: init.player - ref, crit: false, fumble: false },
          modifiers: [],
          luckSpent: 0,
          total: init.player,
          dv: 0,
          success: true,
          margin: init.player,
        },
        initiative: init,
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
