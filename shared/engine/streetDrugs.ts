/**
 * Uso de drogas de rua: efeito primário (efeito ativo com duração), teste de vício na hora
 * e abstinência reconciliada sempre que o relógio anda.
 */
import type { ActiveEffect, GameState, StreetDrugKey } from '../types/game';
import { STREET_DRUGS } from '../rules/streetDrugs';
import { advanceGameTime } from '../rules/world';
import type { Rng } from './dice';
import { characterWoundState } from './health';
import { emit } from './events';
import { makeId } from './ids';
import { instantCheck } from './instant';
import { humanityTransition } from './humanity';
import { syncWithdrawal } from './withdrawal';

export { syncWithdrawal };

export function useStreetDrug(s0: GameState, key: StreetDrugKey, rng: Rng): { state: GameState; addictedNow: boolean; summary: string } {
  const def = STREET_DRUGS[key];
  const c = s0.character;
  const mods = { ...def.mods };
  // Black Lace: anula a penalidade de Gravemente Ferido (−2) enquanto dura.
  if (key === 'black_lace' && characterWoundState(c) === 'seriously') mods.all = 2;
  const eff: ActiveEffect = { id: makeId('eff'), name: def.label, source: 'drug', description: def.description, penalties: mods, expiresAt: advanceGameTime(s0.world.time, def.minutes) };
  let s: GameState = { ...s0, activeEffects: [...s0.activeEffects.filter(e => e.name !== def.label), eff] };
  s = emit(s, 'EFFECT_ADDED', def.label, { target: eff.id, data: mods });
  const parts = [def.description];

  if (key === 'black_lace') {
    const loss = rng(6) + rng(6);
    const before = s;
    s = { ...s, character: { ...s.character, humanity: { ...s.character.humanity, current: Math.max(0, s.character.humanity.current - loss) } } };
    s = humanityTransition(before, emit(s, 'HUMANITY_CHANGED', `Black Lace: −${loss} Humanidade`, { value: -loss }));
    parts.push(`−${loss} Humanidade`);
  }

  let addictedNow = false;
  if (!(s.character.addictions ?? []).includes(key)) {
    const res = instantCheck(s, { reason: `Resistir ao vício (${def.label})`, stat: 'WILL', skillId: 'resist_torture', dv: def.addictionDv }, rng);
    s = res.state;
    if (!res.outcome.check.success) {
      addictedNow = true;
      s = { ...s, character: { ...s.character, addictions: [...(s.character.addictions ?? []), key] } };
      s = emit(s, 'CONDITION_CHANGED', `Viciado em ${def.label}`, { target: 'player', data: { addiction: key } });
      parts.push(`VICIOU em ${def.label} (sem a droga: ${Object.entries(def.withdrawal).map(([k, v]) => `${k} ${v}`).join(', ')})`);
    }
  }
  return { state: syncWithdrawal(s), addictedNow, summary: parts.join(' · ') };
}
