/**
 * Encarada (Facedown, Cyberpunk RED): COOL + Reputação + 1d10 de cada lado.
 * Quem perde recua — ou, se lutar mesmo assim, tem −2 em tudo contra o vencedor.
 */
import type { Combatant, GameState, Modifier, Npc, RollOutcome, RollRequest } from '../types/game';
import { NPC_TEMPLATES, type NpcTier } from '../rules/npcTemplates';
import type { Rng } from './dice';
import { resolveCheck } from './checks';
import { appendChat } from './reducer';
import { emit } from './events';
import { makeId } from './ids';

/** Reputação típica por patamar de ficha (capanga ninguém conhece; chefão todo mundo teme). */
export const TIER_REPUTATION: Record<NpcTier, number> = { mook: 0, lieutenant: 2, miniboss: 4 };

function npcReputation(npc: Npc): number {
  return npc.respect >= 70 ? 4 : npc.respect >= 40 ? 2 : 0;
}

export interface FacedownResult {
  state: GameState;
  outcome: RollOutcome;
  won: boolean;
  opponent: { name: string; cool: number; reputation: number; roll: number; total: number };
}

export function facedown(s0: GameState, target: { combatant?: Combatant; npc?: Npc }, rng: Rng): FacedownResult {
  const name = target.combatant?.name ?? target.npc?.name ?? 'Alvo';
  const tier = target.combatant?.template ? NPC_TEMPLATES[target.combatant.template]?.tier : undefined;
  const cool = target.combatant?.cool ?? 5;
  const reputation = tier ? TIER_REPUTATION[tier] : target.npc ? npcReputation(target.npc) : 0;
  // O medo que o NPC já tem de você pesa a seu favor.
  const fear = target.npc && target.npc.fear >= 60 ? 2 : 0;
  const roll = rng(10);
  const oppTotal = cool + reputation + roll;

  const mods: Modifier[] = [];
  if (s0.character.reputation) mods.push({ label: 'Reputação', value: s0.character.reputation });
  if (fear) mods.push({ label: `${name} tem medo de você`, value: fear });
  const request: RollRequest = { id: makeId('roll'), kind: 'check', origin: 'gm', reason: `Encarada com ${name}`, stat: 'COOL', skillId: null, dv: oppTotal, modifier: 0 };
  // Empate: ninguém recua — fica para quem tem mais Reputação (senão, o NPC).
  const check = resolveCheck(s0.character, { stat: 'COOL', skillId: null, dv: oppTotal, modifiers: mods }, rng);
  const won = check.total > oppTotal || (check.total === oppTotal && s0.character.reputation > reputation);
  const outcome: RollOutcome = { request, check: { ...check, success: won } };

  let s = appendChat(s0, { kind: 'roll', text: request.reason, roll: outcome });
  const winner = won ? 'player' : 'npc';
  if (target.combatant) {
    const id = target.combatant.id;
    s = { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => (c.id === id ? { ...c, facedown: winner } : c)) } };
  }
  if (target.npc) {
    const id = target.npc.id;
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    s = { ...s, npcs: s.npcs.map(n => (n.id === id ? { ...n, fear: clamp(n.fear + (won ? 15 : -5)), respect: clamp(n.respect + (won ? 5 : -10)) } : n)) };
  }
  s = emit(s, 'CHECK_RESOLVED', `Encarada com ${name}: ${won ? 'o outro recuou' : 'você piscou primeiro'} (${check.total} × ${oppTotal})`, {
    source: 'player',
    target: target.combatant?.id ?? target.npc?.id,
    value: won,
    data: { total: check.total, dv: oppTotal },
  });
  return { state: s, outcome, won, opponent: { name, cool, reputation, roll, total: oppTotal } };
}
