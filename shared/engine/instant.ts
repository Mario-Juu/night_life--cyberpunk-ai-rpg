/**
 * Teste resolvido NA HORA pelo motor (o efeito é aplicado em seguida pela ferramenta).
 * Fica no chat como rolagem — e, como qualquer rolagem, escondido até a narração.
 */
import type { GameState, Modifier, RollOutcome, RollRequest, StatKey } from '../types/game';
import type { Rng } from './dice';
import { resolveCheck } from './checks';
import { appendChat } from './reducer';
import { emit } from './events';
import { makeId } from './ids';

export function instantCheck(
  s: GameState,
  opts: { reason: string; stat: StatKey; skillId: string; dv: number; bonus?: Modifier; modifiers?: Modifier[] },
  rng: Rng,
): { state: GameState; outcome: RollOutcome } {
  const request: RollRequest = { id: makeId('roll'), kind: 'check', origin: 'gm', reason: opts.reason, stat: opts.stat, skillId: opts.skillId, dv: opts.dv, modifier: 0 };
  const modifiers = [...(opts.bonus ? [opts.bonus] : []), ...(opts.modifiers ?? [])];
  const check = resolveCheck(s.character, { stat: opts.stat, skillId: opts.skillId, dv: opts.dv, modifiers }, rng);
  const outcome: RollOutcome = { request, check };
  let next = appendChat(s, { kind: 'roll', text: opts.reason, roll: outcome });
  next = emit(next, 'CHECK_RESOLVED', `${opts.reason}: ${check.success ? 'sucesso' : 'falha'} (total ${check.total})`, {
    source: 'player',
    target: opts.skillId,
    value: check.success,
    data: { skillId: opts.skillId, total: check.total, dv: opts.dv, margin: check.margin },
  });
  return { state: next, outcome };
}
