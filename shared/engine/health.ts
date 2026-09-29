import type {
  ActiveEffect,
  Character,
  CriticalInjury,
  DamageApplication,
  DamageRoll,
  HitLocation,
  InventoryItem,
  Modifier,
  StatKey,
} from '../types/game';
import { randomCriticalInjury } from '../rules/criticalInjuries';
import { armorPenalty } from '../rules/weapons';
import { cryptoRng, type Rng } from './dice';
import { makeId } from './ids';

export type WoundState = 'healthy' | 'lightly' | 'seriously' | 'mortally' | 'dead';

export const WOUND_LABEL: Record<WoundState, string> = {
  healthy: 'Íntegro',
  lightly: 'Ferido',
  seriously: 'Gravemente ferido',
  mortally: 'Mortalmente ferido',
  dead: 'Morto',
};

export function woundState(hp: { current: number; max: number }, dead = false): WoundState {
  if (dead) return 'dead';
  if (hp.current <= 0) return 'mortally';
  if (hp.current < hp.max / 2) return 'seriously';
  if (hp.current < hp.max) return 'lightly';
  return 'healthy';
}

/** Penalidade de ferimento para TODAS as ações (Cyberpunk RED). */
export function woundPenalty(state: WoundState): number {
  if (state === 'seriously') return -2;
  if (state === 'mortally') return -4;
  return 0;
}

export function characterWoundState(c: Character): WoundState {
  return woundState(c.hp, c.dead);
}

/** Todas as penalidades que afetam um teste com o atributo dado. */
export function checkPenalties(c: Character, stat: StatKey): Modifier[] {
  const mods: Modifier[] = [];
  const wp = woundPenalty(characterWoundState(c));
  if (wp !== 0) mods.push({ label: WOUND_LABEL[characterWoundState(c)], value: wp });
  for (const inj of c.criticalInjuries) {
    const v = (inj.penalties[stat] ?? 0) + (inj.penalties.all ?? 0);
    if (v !== 0) mods.push({ label: inj.name, value: v });
  }
  // Armadura pesada pesa em REF, DEX e MOVE (vale a pior peça equipada).
  if (stat === 'REF' || stat === 'DEX' || stat === 'MOVE') {
    const worst = Math.min(0, ...c.inventory.filter(i => i.equipped && i.armor).map(i => armorPenalty(i.armor!.maxSp)));
    if (worst !== 0) mods.push({ label: 'Armadura pesada', value: worst });
  }
  // Mortalmente ferido: além do −4 geral, −6 em MOVE.
  if (stat === 'MOVE' && characterWoundState(c) === 'mortally') mods.push({ label: 'Rastejando', value: -6 });
  return mods;
}

/** Penalidades de efeitos temporários ativos (drogas, fogo, atordoamento…). */
export function effectPenalties(effects: ActiveEffect[], stat: StatKey): Modifier[] {
  return effects
    .map(e => ({ label: e.name, value: (e.penalties[stat] ?? 0) + (e.penalties.all ?? 0) }))
    .filter(m => m.value !== 0);
}

export function equippedArmor(c: Character, slot: HitLocation): InventoryItem | undefined {
  return c.inventory
    .filter(i => i.category === 'armor' && i.equipped && i.armor?.slot === slot)
    .sort((a, b) => (b.armor?.sp ?? 0) - (a.armor?.sp ?? 0))[0];
}

/** SP derivado da armadura equipada — nunca armazenado solto. */
export function characterSp(c: Character): { head: number; body: number } {
  return {
    head: equippedArmor(c, 'head')?.armor?.sp ?? 0,
    body: equippedArmor(c, 'body')?.armor?.sp ?? 0,
  };
}

export interface DamageMath {
  throughArmor: number;
  hpDamage: number;
  critBonus: number;
  ablated: boolean;
  effectiveSp: number;
}

/**
 * Regra central de dano:
 * dano − SP (armas brancas: metade da SP, arredondada p/ cima) → cabeça ×2 →
 * ablação de 1 SP se penetrar → crítico +5 direto no HP, uma única vez, após a armadura.
 */
export function computeDamage(params: {
  raw: number;
  sp: number;
  location: HitLocation;
  halfArmor?: boolean;
  critical: boolean;
}): DamageMath {
  // Armas brancas ignoram metade da SP, arredondada para cima (resta a metade para baixo).
  const effectiveSp = params.halfArmor ? Math.floor(params.sp / 2) : params.sp;
  const throughArmor = Math.max(0, params.raw - effectiveSp);
  const multiplied = params.location === 'head' ? throughArmor * 2 : throughArmor;
  const critBonus = params.critical ? 5 : 0;
  return {
    throughArmor,
    hpDamage: multiplied + critBonus,
    critBonus,
    ablated: throughArmor > 0 && params.sp > 0,
    effectiveSp,
  };
}

/**
 * Calcula (com RNG para o ferimento crítico) e aplica dano ao personagem do jogador.
 * Dano sofrido enquanto já está no chão piora o Teste de Morte.
 */
export function applyDamageToCharacter(
  c: Character,
  damage: DamageRoll,
  location: HitLocation,
  opts: { halfArmor?: boolean; rng?: Rng; bypassArmor?: boolean } = {},
): { character: Character; application: DamageApplication } {
  const rng = opts.rng ?? cryptoRng;
  const armorItem = opts.bypassArmor ? undefined : equippedArmor(c, location);
  const spBefore = armorItem?.armor?.sp ?? 0;
  const math = computeDamage({ raw: damage.total, sp: spBefore, location, halfArmor: opts.halfArmor, critical: damage.critical });
  const spAfter = math.ablated ? Math.max(0, spBefore - 1) : spBefore;
  const injury: CriticalInjury | undefined = damage.critical
    ? { id: makeId('inj'), ...randomCriticalInjury(location, rng) }
    : undefined;

  const application: DamageApplication = {
    location,
    raw: damage.total,
    spBefore,
    spAfter,
    throughArmor: math.throughArmor,
    hpDamage: math.hpDamage,
    critBonus: math.critBonus,
    hpBefore: c.hp.current,
    hpAfter: Math.max(0, c.hp.current - math.hpDamage),
    ablated: spAfter < spBefore,
    criticalInjury: injury,
  };
  return { character: applyDamageApplication(c, application), application };
}

/**
 * Reaplica, de forma determinística, uma DamageApplication já calculada
 * (o reducer usa isto para não depender de RNG).
 */
export function applyDamageApplication(c: Character, app: DamageApplication): Character {
  const armorItem = equippedArmor(c, app.location);
  const inventory =
    armorItem && app.ablated
      ? c.inventory.map(i => (i.id === armorItem.id && i.armor ? { ...i, armor: { ...i.armor, sp: app.spAfter } } : i))
      : c.inventory;
  const hpAfter = Math.max(0, c.hp.current - app.hpDamage);
  const tookDamageWhileDown = c.hp.current <= 0 && app.hpDamage > 0;
  return {
    ...c,
    inventory,
    hp: { ...c.hp, current: hpAfter },
    criticalInjuries: app.criticalInjury ? [...c.criticalInjuries, app.criticalInjury] : c.criticalInjuries,
    stabilized: hpAfter > 0 ? c.stabilized : app.hpDamage > 0 ? false : c.stabilized,
    deathSavePenalty: c.deathSavePenalty + (tookDamageWhileDown ? 1 : 0),
  };
}

export function healCharacter(c: Character, amount: number): Character {
  const current = Math.min(c.hp.max, c.hp.current + Math.max(0, amount));
  return {
    ...c,
    hp: { ...c.hp, current },
    deathSavePenalty: current > 0 ? 0 : c.deathSavePenalty,
    stabilized: current > 0 ? false : c.stabilized,
  };
}

/**
 * Teste de Morte (Cyberpunk RED): 1d10 + penalidade acumulada ≤ BODY.
 * 10 natural sempre falha. Cada teste aumenta a penalidade em 1.
 */
/**
 * Penalidade do Teste de Morte (Cyberpunk RED): +1 a cada teste já feito
 * e +1 para cada Ferimento Crítico sofrido.
 */
export function deathSavePenalty(c: Character): number {
  return c.deathSavePenalty + c.criticalInjuries.length;
}

export function resolveDeathSave(c: Character, rng: Rng = cryptoRng): { roll: number; penalty: number; target: number; success: boolean } {
  const roll = rng(10);
  const target = c.stats.BODY;
  const penalty = deathSavePenalty(c);
  const success = roll !== 10 && roll + penalty <= target;
  return { roll, penalty, target, success };
}

export function needsDeathSave(c: Character): boolean {
  return !c.dead && c.hp.current <= 0 && !c.stabilized;
}
