/**
 * Briga avançada (Cyberpunk RED, CRB p.176–184):
 * - Agarrar: DEX + Briga + 1d10 contra DEX + Briga + 1d10 do alvo (empate: defensor). Os dois ficam com −2.
 * - Estrangular: CORPO do atacante direto nos PV (ignora armadura, sem ablação). Quem tinha PV > 1 e
 *   cairia a 0 fica com 1 e apaga; 3 rodadas seguidas estrangulado = apaga de qualquer jeito.
 * - Arremessar: CORPO direto nos PV, encerra o agarrão, o alvo cai (Caído).
 * - Escudo humano: tiros contra você acertam o agarrado (com a armadura dele); morto, vira
 *   escudo-cadáver com PV = CORPO dele.
 * - Soltar é livre; escapar de um agarrão é o mesmo teste resistido.
 */
import type { Combatant, GameState } from '../types/game';
import type { Rng } from './dice';
import { rollD10 } from './dice';
import { statValue } from './checks';
import { hasCondition, setCondition } from './conditions';
import { instantCheck } from './instant';
import { emit } from './events';
import { findCombatantLoose } from './combatants';
import { movementValue } from './combat';
import { BRACKET_NEAR_EDGE, moveMeters } from '../rules/weapons';

export type BrawlAction = 'grab' | 'choke' | 'throw' | 'shield' | 'release' | 'escape';
export const BRAWL_ACTIONS: BrawlAction[] = ['grab', 'choke', 'throw', 'shield', 'release', 'escape'];

export interface BrawlResult {
  state: GameState;
  ok: boolean;
  summary: string;
}

const fail = (state: GameState, summary: string): BrawlResult => ({ state, ok: false, summary });

function patchFoe(s: GameState, id: string, fn: (c: Combatant) => Combatant): GameState {
  return { ...s, combat: { ...s.combat, combatants: s.combat.combatants.map(c => (c.id === id ? fn(c) : c)) } };
}

/** Solta o agarrado (e o escudo humano). */
export function releaseGrapple(s0: GameState): GameState {
  const id = s0.character.grappling;
  let s: GameState = { ...s0, character: { ...s0.character, grappling: undefined, humanShield: undefined } };
  if (id) s = patchFoe(s, id, c => ({ ...c, conditions: setCondition(c.conditions, 'grappled', false, s.turn), chokeRounds: 0 }));
  return s;
}

/** Dano direto nos PV (estrangular/arremessar), com a regra de "apagar" do estrangulamento. */
function directDamage(s: GameState, foe: Combatant, dmg: number, choke: boolean): { state: GameState; text: string } {
  let hp = Math.max(0, foe.hp.current - dmg);
  let knocked = false;
  if (choke && foe.hp.current > 1 && hp <= 0) {
    hp = 1;
    knocked = true;
  }
  const rounds = choke ? (foe.chokeRounds ?? 0) + 1 : foe.chokeRounds ?? 0;
  if (choke && rounds >= 3) knocked = true;
  const down = hp <= 0 || knocked;
  const next = patchFoe(s, foe.id, c => ({
    ...c,
    hp: { ...c.hp, current: hp },
    chokeRounds: rounds,
    status: down ? 'down' : c.status,
    conditions: knocked ? setCondition(c.conditions, 'unconscious', true, s.turn, 'estrangulado') : c.conditions,
  }));
  const text = `${foe.name}: −${foe.hp.current - hp} PV (${foe.hp.current} → ${hp})${knocked ? ' — APAGOU' : down ? ' — caiu' : ''}`;
  return { state: emit(next, 'DAMAGE_DEALT', text, { source: 'player', target: foe.id, value: foe.hp.current - hp, data: { brawl: choke ? 'choke' : 'throw' } }), text };
}

export function brawl(s0: GameState, action: BrawlAction, targetId: string | undefined, rng: Rng): BrawlResult {
  const c = s0.character;
  if (c.dead) return fail(s0, 'O personagem está morto.');
  // Agarrado que caiu/fugiu/morreu não prende mais ninguém (senão o jogador fica preso a um corpo).
  const held = c.grappling ? s0.combat.combatants.find(x => x.id === c.grappling && x.status === 'active') : undefined;
  const body = statValue(c, 'BODY');

  switch (action) {
    case 'grab': {
      if (hasCondition(c.conditions, 'restrained') || hasCondition(c.conditions, 'unconscious')) return fail(s0, 'Você não está em condições de agarrar ninguém.');
      if (held) return fail(s0, `Você já está agarrando ${held.name}.`);
      const foe = findCombatantLoose(s0.combat.combatants, targetId);
      if (!foe) return fail(s0, 'Esse alvo não está no combate (entre em combate com ele antes).');
      if (foe.side === 'ally') return fail(s0, `${foe.name} está do seu lado — use dismiss_npc antes.`);
      // Ação de Movimento (MOVE × 2 m): cola no alvo se ele estiver ao alcance.
      if (foe.distance !== 'melee' && moveMeters(movementValue(c)) < BRACKET_NEAR_EDGE[foe.distance]) return fail(s0, `${foe.name} está longe demais para alcançar neste turno — aproxime-se primeiro.`);
      // Teste resistido: o alvo rola DEX + Briga + 1d10 agora (empate favorece o defensor).
      const defense = (foe.brawlingBase ?? foe.evasionBase) + rollD10(rng).total + (hasCondition(foe.conditions, 'grappled') ? -2 : 0);
      const res = instantCheck(s0, { reason: `Agarrar ${foe.name}`, stat: 'DEX', skillId: 'brawling', dv: defense }, rng);
      let s = res.state;
      if (!res.outcome.check.success) return { state: s, ok: true, summary: `${foe.name} escapou do agarrão.` };
      s = { ...s, character: { ...s.character, grappling: foe.id } };
      s = patchFoe(s, foe.id, x => ({ ...x, distance: 'melee' }));
      s = patchFoe(s, foe.id, x => ({ ...x, conditions: setCondition(x.conditions, 'grappled', true, s.turn, 'agarrado pelo jogador'), chokeRounds: 0 }));
      return { state: emit(s, 'CONDITION_CHANGED', `${foe.name} agarrado`, { target: foe.id, value: 'grappled' }), ok: true, summary: `Agarrou ${foe.name}: os dois com −2 em tudo enquanto durar.` };
    }
    case 'choke': {
      if (!held) return fail(s0, 'Você precisa agarrar alguém antes de estrangular.');
      const r = directDamage(s0, held, body, true);
      let s = r.state;
      const after = s.combat.combatants.find(x => x.id === held.id)!;
      if (after.status !== 'active') s = releaseGrapple(s);
      return { state: s, ok: true, summary: `Estrangulou (CORPO ${body}, ignora armadura). ${r.text}` };
    }
    case 'throw': {
      if (!held) return fail(s0, 'Você precisa agarrar alguém antes de arremessar.');
      let s = releaseGrapple(s0);
      const r = directDamage(s, held, body, false);
      s = patchFoe(r.state, held.id, x => ({ ...x, conditions: setCondition(x.conditions, 'prone', true, s.turn, 'arremessado') }));
      return { state: s, ok: true, summary: `Arremessou ${held.name} no chão (CORPO ${body}, ignora armadura). ${r.text}; agarrão encerrado.` };
    }
    case 'shield': {
      if (!held) return fail(s0, 'Você precisa agarrar alguém para usar como escudo humano.');
      if (c.humanShield?.id === held.id) return fail(s0, `${held.name} já é seu escudo.`);
      const s = { ...s0, character: { ...c, humanShield: { id: held.id } } };
      return { state: emit(s, 'CONDITION_CHANGED', `${held.name} como escudo humano`, { target: held.id }), ok: true, summary: `${held.name} vira escudo humano: os tiros contra você acertam nele (não protege a cabeça).` };
    }
    case 'release': {
      if (!held) return fail(s0, 'Você não está agarrando ninguém.');
      return { state: releaseGrapple(s0), ok: true, summary: `Soltou ${held.name}.` };
    }
    case 'escape': {
      if (!hasCondition(c.conditions, 'grappled')) return fail(s0, 'Ninguém está te agarrando.');
      const grabber = findCombatantLoose(s0.combat.combatants, targetId) ?? s0.combat.combatants.filter(x => x.status === 'active' && x.side !== 'ally' && x.distance === 'melee').sort((a, b) => (b.brawlingBase ?? 0) - (a.brawlingBase ?? 0))[0];
      const defense = (grabber?.brawlingBase ?? 10) + rollD10(rng).total;
      const res = instantCheck(s0, { reason: `Escapar do agarrão${grabber ? ` de ${grabber.name}` : ''}`, stat: 'DEX', skillId: 'brawling', dv: defense }, rng);
      let s = res.state;
      if (!res.outcome.check.success) return { state: s, ok: true, summary: 'O agarrão segura firme.' };
      s = { ...s, character: { ...s.character, conditions: setCondition(s.character.conditions, 'grappled', false, s.turn) } };
      return { state: emit(s, 'CONDITION_CHANGED', 'Escapou do agarrão', { target: 'player' }), ok: true, summary: 'Você se solta do agarrão.' };
    }
  }
}
