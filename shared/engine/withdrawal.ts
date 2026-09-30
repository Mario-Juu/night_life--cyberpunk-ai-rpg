/** Abstinência de drogas de rua (módulo leve: o relógio do mundo chama a cada avanço). */
import type { ActiveEffect, GameState } from '../types/game';
import { STREET_DRUGS, STREET_DRUG_KEYS, withdrawalName } from '../rules/streetDrugs';
import { makeId } from './ids';

/** Abstinência aparece para cada vício sem a droga no corpo — e some quando ela volta. */
export function syncWithdrawal(state: GameState): GameState {
  const addictions = state.character.addictions ?? [];
  let effects = state.activeEffects;
  let changed = false;
  for (const k of STREET_DRUG_KEYS) {
    const name = withdrawalName(k);
    const high = effects.some(e => e.name === STREET_DRUGS[k].label);
    const has = effects.some(e => e.name === name);
    const need = addictions.includes(k) && !high;
    if (need && !has) {
      const eff: ActiveEffect = { id: makeId('eff'), name, source: 'withdrawal', description: 'Viciado: a falta da droga pesa até a próxima dose ou uma desintoxicação.', penalties: STREET_DRUGS[k].withdrawal, expiresAt: null };
      effects = [...effects, eff];
      changed = true;
    } else if (!need && has) {
      effects = effects.filter(e => e.name !== name);
      changed = true;
    }
  }
  return changed ? { ...state, activeEffects: effects } : state;
}
