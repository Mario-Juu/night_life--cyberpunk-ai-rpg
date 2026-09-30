/**
 * Drogas médicas do Medicânico (Farmacêutica). Efeitos aplicados pelo motor, de forma determinística.
 */
import type { DrugKey, GameState, InventoryItem } from '../types/game';
import { DRUGS } from '../rules/roles';
import { advanceGameTime } from '../rules/world';
import { characterWoundState, healCharacter } from './health';
import { emit } from './events';
import { makeId } from './ids';

const SPEEDHEAL_LOCK = 'Speedheal (recuperação)';
const TOXIN = /veneno|toxina|envenen|droga|intoxic|scorpion|liche/i;

function effect(s: GameState, name: string, description: string, minutes: number, penalties: Record<string, number> = {}): GameState {
  const eff = { id: makeId('eff'), name, source: 'drug', description, penalties, expiresAt: advanceGameTime(s.world.time, minutes) };
  return emit({ ...s, activeEffects: [...s.activeEffects.filter(e => e.name !== name), eff] }, 'EFFECT_ADDED', name, { target: eff.id, data: penalties });
}

/** Aplica o efeito de uma droga. Retorna erro legível se não puder usar agora. */
export function applyDrug(s: GameState, drug: DrugKey): GameState | string {
  const c = s.character;
  switch (drug) {
    case 'speedheal': {
      if (s.activeEffects.some(e => e.name === SPEEDHEAL_LOCK)) return 'Speedheal só funciona uma vez por dia.';
      const amount = c.stats.BODY + c.stats.WILL;
      const character = healCharacter(c, amount);
      const gained = character.hp.current - c.hp.current;
      const next = effect({ ...s, character }, SPEEDHEAL_LOCK, 'O corpo precisa de um dia antes de outra dose.', 24 * 60);
      return emit(next, 'HEALED', `+${gained} PV (Speedheal)`, { value: gained });
    }
    case 'antibiotic':
      return effect(s, DRUGS.antibiotic.label, DRUGS.antibiotic.description, 7 * 24 * 60);
    case 'stim': {
      // Anula a penalidade de Gravemente Ferido (−2) por 1 hora.
      const offset = characterWoundState(c) === 'seriously' ? 2 : 0;
      return effect(s, DRUGS.stim.label, DRUGS.stim.description, 60, offset ? { all: offset } : {});
    }
    case 'rapidetox': {
      const removed = s.activeEffects.filter(e => e.name !== SPEEDHEAL_LOCK && (e.source === 'drug' || TOXIN.test(e.name)));
      return emit({ ...s, activeEffects: s.activeEffects.filter(e => !removed.includes(e)) }, 'EFFECT_EXPIRED', `Rapidetox limpou: ${removed.map(e => e.name).join(', ') || 'nada'}`);
    }
    case 'surge':
      return effect(s, DRUGS.surge.label, DRUGS.surge.description, 24 * 60);
  }
}

export function drugItem(drug: DrugKey, quantity: number): InventoryItem {
  return { id: makeId('item'), name: DRUGS[drug].label, category: 'consumable', quantity, description: DRUGS[drug].description, drug, value: 50 };
}
