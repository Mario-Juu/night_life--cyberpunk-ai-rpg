/**
 * Transições de Humanidade: o motor anuncia a entrada (e a saída) da ciberpsicose.
 */
import type { GameState } from '../types/game';
import { humanityBand, isCyberpsycho } from '../rules/humanity';
import { appendChat } from './reducer';
import { emit } from './events';

/** Compara antes/depois e registra mudança de faixa (e a ciberpsicose). */
export function humanityTransition(before: GameState, after: GameState): GameState {
  const was = isCyberpsycho(before.character);
  const now = isCyberpsycho(after.character);
  let s = after;
  if (!was && now) {
    s = emit(s, 'CYBERPSYCHOSIS', 'CIBERPSICOSE: a Humanidade chegou a zero', { target: 'player' });
    s = appendChat(s, { kind: 'system', text: '⚠ SISTEMA COMPROMETIDO — CIBERPSICOSE. Você perdeu o controle.' });
  } else if (was && !now) {
    s = emit(s, 'HUMANITY_CHANGED', 'Saiu da ciberpsicose (Humanidade acima de zero)', { target: 'player' });
    s = appendChat(s, { kind: 'system', text: 'O ruído baixa. Você volta a ser você — por enquanto.' });
  } else {
    const a = humanityBand(before.character).band;
    const b = humanityBand(after.character);
    if (a !== b.band && b.band !== 'stable') s = emit(s, 'HUMANITY_CHANGED', `Humanidade: ${b.label}`, { target: 'player', value: after.character.humanity.current });
  }
  return s;
}
