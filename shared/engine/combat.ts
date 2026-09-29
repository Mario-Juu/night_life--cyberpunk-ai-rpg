import type {
  AttackResult,
  Character,
  Combatant,
  CombatState,
  DamageApplication,
  EnemyAttackResult,
  GameState,
  InventoryItem,
  Modifier,
  RollOutcome,
  RollRequest,
  WeaponClass,
} from '../types/game';
import { AIMED_SHOT_PENALTY, WEAPONS, isArmorPiercingMelee, rangedDv, unarmedDamage } from '../rules/weapons';
import { randomCriticalInjury } from '../rules/criticalInjuries';
import { cryptoRng, rollD10, rollDamage, type Rng } from './dice';
import { resolveCheck, skillValue, statValue } from './checks';
import { applyDamageToCharacter, checkPenalties, computeDamage, effectPenalties } from './health';
import { makeId } from './ids';

export const UNARMED: InventoryItem = {
  id: 'unarmed',
  name: 'Punhos',
  category: 'weapon',
  quantity: 1,
  description: 'Socos e chutes.',
  weapon: { weaponClass: 'unarmed', damage: '1d6', magSize: null, loaded: 0, ammo: null },
};

export function playerWeapons(c: Character): InventoryItem[] {
  return c.inventory.filter(i => i.category === 'weapon' && i.weapon);
}

/** Arma pelo id ('unarmed' = punhos), ou a arma equipada, ou os punhos. */
export function getPlayerWeapon(c: Character, weaponId?: string | null): InventoryItem {
  if (weaponId === UNARMED.id) return UNARMED;
  const weapons = playerWeapons(c);
  return (
    (weaponId ? weapons.find(w => w.id === weaponId) : undefined) ??
    weapons.find(w => w.equipped) ??
    weapons[0] ??
    UNARMED
  );
}

export function isMeleeWeapon(item: InventoryItem): boolean {
  return WEAPONS[item.weapon?.weaponClass ?? 'unarmed'].melee;
}

export function activeEnemies(combat: CombatState): Combatant[] {
  return combat.combatants.filter(c => c.status === 'active');
}

/** DV estimado mostrado ao jogador antes de atacar. */
export function previewAttackDv(weapon: InventoryItem, target: Combatant): { dv: number | null; label: string } {
  const cls = weapon.weapon?.weaponClass ?? 'unarmed';
  if (WEAPONS[cls].melee) return { dv: null, label: `Evasão do alvo (${target.evasionBase} + 1d10)` };
  if (target.distance === 'melee' && !WEAPONS[cls].melee) {
    const dv = rangedDv(cls, 'melee');
    return { dv, label: `DV ${dv} (queima-roupa)` };
  }
  const dv = rangedDv(cls, target.distance);
  if (dv === null) return { dv: null, label: 'Fora do alcance' };
  const coverBonus = target.cover === 'partial' ? 2 : 0;
  return { dv: dv + coverBonus, label: `DV ${dv + coverBonus}${coverBonus ? ' (meia cobertura +2)' : ''}` };
}

/**
 * Ataque do jogador contra um combatente. Resolve acerto, munição, dano, SP e ferimento crítico.
 * Retorna um RollOutcome completo; o reducer aplica de forma determinística.
 */
export function resolvePlayerAttack(
  state: GameState,
  request: RollRequest,
  luckSpent: number,
  rng: Rng = cryptoRng,
): RollOutcome {
  const c = state.character;
  const weapon = getPlayerWeapon(c, request.weaponId);
  const cls: WeaponClass = weapon.weapon?.weaponClass ?? 'unarmed';
  const profile = WEAPONS[cls];
  const target = state.combat.combatants.find(t => t.id === request.targetId && t.status === 'active');
  const stat = profile.melee ? 'DEX' : 'REF';
  const skillId = profile.skillId;
  const ammoBefore = profile.melee ? null : weapon.weapon?.loaded ?? 0;

  const baseAttack: AttackResult = {
    weaponId: weapon.id,
    weaponName: weapon.name,
    targetId: target?.id ?? request.targetId ?? '',
    targetName: target?.name ?? 'Alvo',
    hit: false,
    ammoBefore,
    ammoAfter: ammoBefore,
  };

  const mods: Modifier[] = [
    ...(request.modifier ? [{ label: 'Situação', value: request.modifier }] : []),
    ...(request.modifiers ?? []),
    ...effectPenalties(state.activeEffects, stat),
  ];
  if (request.aimedHead) mods.push({ label: 'Tiro mirado (cabeça)', value: AIMED_SHOT_PENALTY });

  // Falhas automáticas (sem rolar dano).
  const failWith = (failure: AttackResult['failure'], dv: number): RollOutcome => ({
    request,
    check: {
      stat,
      statValue: statValue(c, stat),
      skillId,
      skillValue: skillValue(c, skillId),
      d10: { rolls: [], natural: 0, total: 0, crit: false, fumble: false },
      modifiers: mods,
      luckSpent: 0,
      total: 0,
      dv,
      success: false,
      margin: -dv,
    },
    attack: { ...baseAttack, failure },
  });

  if (!target) return failWith('no_target', request.dv);
  if (!profile.melee && (ammoBefore ?? 0) <= 0) return failWith('no_ammo', request.dv);
  if (target.cover === 'full') return failWith('in_cover', request.dv);

  let dv: number;
  if (profile.melee) {
    if (target.distance !== 'melee') return failWith('out_of_range', request.dv);
    dv = target.evasionBase + rollD10(rng).total;
  } else {
    const base = rangedDv(cls, target.distance);
    if (base === null) return failWith('out_of_range', request.dv);
    dv = base + (target.cover === 'partial' ? 2 : 0);
    // Alvos com REF 8+ podem esquivar de projéteis: vale o maior.
    if (target.ref >= 8) dv = Math.max(dv, target.evasionBase + rollD10(rng).total);
  }

  const check = resolveCheck(c, { stat, skillId, dv, modifiers: mods, luckSpent }, rng);
  const ammoAfter = profile.melee ? null : Math.max(0, (ammoBefore ?? 0) - 1);
  const attack: AttackResult = { ...baseAttack, hit: check.success, ammoAfter };

  if (check.success) {
    const location = request.aimedHead ? 'head' : 'body';
    const notation = cls === 'unarmed' ? unarmedDamage(c.stats.BODY) : weapon.weapon?.damage ?? profile.defaultDamage;
    const damage = rollDamage(notation, rng);
    const spBefore = location === 'head' ? target.sp.head : target.sp.body;
    const math = computeDamage({ raw: damage.total, sp: spBefore, location, halfArmor: isArmorPiercingMelee(cls), critical: damage.critical });
    const spAfter = math.ablated ? Math.max(0, spBefore - 1) : spBefore;
    const hpAfter = Math.max(0, target.hp.current - math.hpDamage);
    const application: DamageApplication = {
      location,
      raw: damage.total,
      spBefore,
      spAfter,
      throughArmor: math.throughArmor,
      hpDamage: math.hpDamage,
      critBonus: math.critBonus,
      hpBefore: target.hp.current,
      hpAfter,
      ablated: spAfter < spBefore,
      criticalInjury: damage.critical ? { id: makeId('inj'), ...randomCriticalInjury(location, rng) } : undefined,
    };
    attack.damage = damage;
    attack.application = application;
    attack.targetStatusAfter = hpAfter <= 0 ? 'down' : 'active';
  }

  return { request: { ...request, dv }, check, attack };
}

/** Aplica o resultado de um ataque do jogador ao estado de combate e à arma. */
export function applyPlayerAttack(state: GameState, attack: AttackResult): { character: Character; combat: CombatState } {
  const character: Character =
    attack.ammoAfter !== null && attack.ammoAfter !== attack.ammoBefore
      ? {
          ...state.character,
          inventory: state.character.inventory.map(i =>
            i.id === attack.weaponId && i.weapon ? { ...i, weapon: { ...i.weapon, loaded: attack.ammoAfter ?? 0 } } : i,
          ),
        }
      : state.character;

  const app = attack.application;
  const combat: CombatState = app
    ? {
        ...state.combat,
        combatants: state.combat.combatants.map(t =>
          t.id === attack.targetId
            ? {
                ...t,
                hp: { ...t.hp, current: app.hpAfter },
                sp: app.location === 'head' ? { ...t.sp, head: app.spAfter } : { ...t.sp, body: app.spAfter },
                status: attack.targetStatusAfter ?? t.status,
              }
            : t,
        ),
      }
    : state.combat;

  return { character, combat };
}

/**
 * Ataque de um inimigo contra o jogador.
 * Distância: DV da tabela; se REF do jogador ≥ 8, ele pode esquivar (vale o maior).
 * Corpo a corpo: rolagem de Evasão do jogador.
 */
export function resolveEnemyAttack(state: GameState, attackerId: string, rng: Rng = cryptoRng): { result: EnemyAttackResult; character: Character } | null {
  const attacker = state.combat.combatants.find(t => t.id === attackerId && t.status === 'active');
  if (!attacker) return null;
  const c = state.character;
  const profile = WEAPONS[attacker.weapon.weaponClass];

  const attackRoll = rollD10(rng);
  const attackTotal = attacker.attackBase + attackRoll.total;

  const evasionPenalty = checkPenalties(c, 'DEX').reduce((s, m) => s + m.value, 0);
  const evasionTotal = () => statValue(c, 'DEX') + skillValue(c, 'evasion') + rollD10(rng).total + evasionPenalty;

  let defenseTotal: number;
  let defenseKind: EnemyAttackResult['defenseKind'];
  if (profile.melee) {
    defenseTotal = evasionTotal();
    defenseKind = 'evasion';
  } else {
    const dv = rangedDv(attacker.weapon.weaponClass, attacker.distance) ?? 99;
    if (c.stats.REF >= 8) {
      const ev = evasionTotal();
      defenseTotal = Math.max(dv, ev);
      defenseKind = ev > dv ? 'evasion' : 'dv';
    } else {
      defenseTotal = dv;
      defenseKind = 'dv';
    }
  }

  const hit = attackTotal > defenseTotal;
  const result: EnemyAttackResult = { attackerId, attackerName: attacker.name, attackTotal, defenseTotal, defenseKind, hit };
  if (!hit) return { result, character: c };

  const damage = rollDamage(attacker.weapon.damage, rng);
  const applied = applyDamageToCharacter(c, damage, 'body', { halfArmor: isArmorPiercingMelee(attacker.weapon.weaponClass), rng });
  return { result: { ...result, damage, application: applied.application }, character: applied.character };
}

/** Iniciativa: REF + 1d10 para todos. */
export function rollInitiative(state: GameState, rng: Rng = cryptoRng): { player: number; enemies: Array<{ id: string; value: number }> } {
  return {
    // Penalidades de REF (armadura pesada, ferimentos) valem para a iniciativa.
    player: statValue(state.character, 'REF') + checkPenalties(state.character, 'REF').reduce((s, m) => s + m.value, 0) + rng(10),
    enemies: activeEnemies(state.combat).map(e => ({ id: e.id, value: e.ref + rng(10) })),
  };
}

/** Ordem de turno (maior iniciativa primeiro). */
export function turnOrder(combat: CombatState): Array<{ id: string; name: string; initiative: number | null; isPlayer: boolean }> {
  const rows = [
    { id: 'player', name: 'Você', initiative: combat.playerInitiative, isPlayer: true },
    ...combat.combatants.filter(t => t.status === 'active').map(t => ({ id: t.id, name: t.name, initiative: t.initiative, isPlayer: false })),
  ];
  return rows.sort((a, b) => (b.initiative ?? -99) - (a.initiative ?? -99));
}

/** Recarga: consome munição do inventário pelo tipo exato. */
export function reloadWeapon(c: Character, weaponId: string): { character: Character; loadedRounds: number } | { error: string } {
  const weapon = c.inventory.find(i => i.id === weaponId);
  if (!weapon?.weapon || weapon.weapon.magSize === null || !weapon.weapon.ammo) return { error: 'Esta arma não usa munição.' };
  const needed = weapon.weapon.magSize - weapon.weapon.loaded;
  if (needed <= 0) return { error: 'O pente já está cheio.' };
  const ammoItem = c.inventory.find(i => i.category === 'ammo' && i.ammoKind === weapon.weapon!.ammo && i.quantity > 0);
  if (!ammoItem) return { error: 'Sem munição compatível no inventário.' };
  const moved = Math.min(needed, ammoItem.quantity);
  const inventory = c.inventory
    .map(i => {
      if (i.id === weapon.id && i.weapon) return { ...i, weapon: { ...i.weapon, loaded: i.weapon.loaded + moved } };
      if (i.id === ammoItem.id) return { ...i, quantity: i.quantity - moved };
      return i;
    })
    .filter(i => !(i.category === 'ammo' && i.quantity <= 0));
  return { character: { ...c, inventory }, loadedRounds: moved };
}

export interface CombatantSpec {
  id?: string;
  name: string;
  hp?: number;
  sp?: number;
  headSp?: number;
  weaponName?: string;
  weaponClass?: string;
  damage?: string;
  attackBase?: number;
  evasionBase?: number;
  ref?: number;
  distance?: string;
  cover?: string;
}

export function makeCombatantId(name: string, existing: Combatant[]): string {
  const base = `foe_${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'x'}`;
  let id = base;
  let n = 2;
  while (existing.some(c => c.id === id)) id = `${base}_${n++}`;
  return id;
}
