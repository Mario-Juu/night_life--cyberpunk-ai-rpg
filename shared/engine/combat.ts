import type {
  AttackResult,
  Character,
  Combatant,
  CombatantStatus,
  CombatState,
  DamageApplication,
  DamageRoll,
  DistanceBracket,
  EnemyAttackResult,
  GameState,
  GrenadeKind,
  HitLocation,
  InventoryItem,
  Modifier,
  RollOutcome,
  RollRequest,
  WeaponClass,
} from '../types/game';
import { AIMED_SHOT_PENALTY, ALL_BRACKETS, BRACKET_NEAR_EDGE, WEAPONS, autofireDv, isArmorPiercingMelee, moveMeters, rangedDv, unarmedDamage } from '../rules/weapons';
import { combatantCannotAct, setCondition } from './conditions';
import { randomCriticalInjury } from '../rules/criticalInjuries';
import { cryptoRng, rollD10, rollDamage, type Rng } from './dice';
import { resolveCheck, skillValue, statValue } from './checks';
import { applyDamageApplication, applyDamageToCharacter, checkPenalties, computeDamage, effectPenalties } from './health';
import { soloValue } from './roles';
import { activeOs, cyberAimedBonus, cyberDamageReduction, cyberDodgeBullets, cyberInitiative, cyberLongRangeBonus, defOf, installedOs } from './cyberBonus';
import type { OsSpec } from '../rules/cyberware';
import { makeId } from './ids';

export const UNARMED: InventoryItem = {
  id: 'unarmed',
  name: 'Punhos',
  category: 'weapon',
  quantity: 1,
  description: 'Socos e chutes.',
  weapon: { weaponClass: 'unarmed', damage: '1d6', magSize: null, loaded: 0, ammo: null },
};

export const MARTIAL_ARTS: InventoryItem = {
  id: 'martial_arts',
  name: 'Artes Marciais',
  category: 'weapon',
  quantity: 1,
  description: 'Golpes treinados: dano pela CORPO, ignora metade da SP.',
  weapon: { weaponClass: 'martial_arts', damage: '1d6', magSize: null, loaded: 0, ammo: null },
};

export function playerWeapons(c: Character): InventoryItem[] {
  return c.inventory.filter(i => i.category === 'weapon' && i.weapon);
}

/** Arma pelo id ('unarmed' = punhos), ou a arma equipada, ou os punhos. */
export function getPlayerWeapon(c: Character, weaponId?: string | null): InventoryItem {
  if (weaponId === UNARMED.id) return UNARMED;
  if (weaponId === MARTIAL_ARTS.id) return MARTIAL_ARTS;
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

/** Aliado do jogador (equipe ou quem o narrador pôs do nosso lado). */
export const isAlly = (t: Combatant) => t.side === 'ally';
/** Inimigo de pé: alvo do jogador, do Ping, da supressão, da ameaça da cena. */
export const isActiveEnemy = (t: Combatant) => t.status === 'active' && !isAlly(t);

export function activeEnemies(combat: CombatState): Combatant[] {
  return combat.combatants.filter(isActiveEnemy);
}

export function activeAllies(combat: CombatState): Combatant[] {
  return combat.combatants.filter(t => t.status === 'active' && isAlly(t));
}

export interface NpcAttackResult {
  attackerId: string;
  defenderId: string;
  hit: boolean;
  skipped?: string;
  jammed?: boolean;
  hpDamage?: number;
  defenderStatusAfter?: CombatantStatus;
  /** Linha para o registro e para o narrador. */
  line: string;
}

/** Faixa entre dois combatentes: a maior das duas (as faixas são medidas a partir do jogador). */
export function betweenCombatants(a: Pick<Combatant, 'distance'>, b: Pick<Combatant, 'distance'>): DistanceBracket {
  return ALL_BRACKETS.indexOf(a.distance) >= ALL_BRACKETS.indexOf(b.distance) ? a.distance : b.distance;
}

/**
 * Ataque entre NPCs (aliado × inimigo): mesma balística do resto do motor.
 * Distância: a maior das duas faixas; corpo a corpo: Evasão do defensor.
 */
export function resolveCombatantAttack(state: GameState, attackerId: string, defenderId: string, rng: Rng = cryptoRng): { combat: CombatState; result: NpcAttackResult } | null {
  const attacker = state.combat.combatants.find(t => t.id === attackerId && t.status === 'active');
  const defender = state.combat.combatants.find(t => t.id === defenderId && t.status === 'active');
  if (!attacker || !defender) return null;
  const tag = (t: Combatant) => (isAlly(t) ? `${t.name} (aliado)` : t.name);
  const stopped = combatantCannotAct(attacker);
  if (stopped) {
    const line = `${tag(attacker)} não age (${stopped}).`;
    return { combat: state.combat, result: { attackerId, defenderId, hit: false, skipped: stopped, line } };
  }
  const patch = (id: string, fn: (t: Combatant) => Combatant): CombatState => ({ ...state.combat, combatants: state.combat.combatants.map(t => (t.id === id ? fn(t) : t)) });
  if (attacker.skipNextAttack) {
    const line = `${tag(attacker)} não ataca (${attacker.skipNextAttack}).`;
    return { combat: patch(attacker.id, t => ({ ...t, skipNextAttack: undefined })), result: { attackerId, defenderId, hit: false, skipped: attacker.skipNextAttack, line } };
  }
  const profile = WEAPONS[attacker.weapon.weaponClass];
  const roll = rollD10(rng);
  if (attacker.weapon.quality === 'poor' && !profile.melee && roll.natural === 1) {
    const line = `A arma de ${tag(attacker)} TRAVOU.`;
    return { combat: patch(attacker.id, t => ({ ...t, skipNextAttack: 'destravando a arma' })), result: { attackerId, defenderId, hit: false, jammed: true, line } };
  }
  const hackMod = (attacker.hacks ?? []).reduce((n, h) => n + (h.attackMod ?? 0), 0) + (defender.hacks ?? []).reduce((n, h) => n + (h.hitBonus ?? 0), 0);
  const attackTotal = attacker.attackBase + roll.total + hackMod + (attacker.weapon.quality === 'excellent' ? 1 : 0);
  if (defender.cover === 'full' && !profile.melee) {
    const line = `${tag(attacker)} atira em ${tag(defender)}, mas a cobertura segura.`;
    return { combat: state.combat, result: { attackerId, defenderId, hit: false, line } };
  }
  const evasion = () => defender.evasionBase + rollD10(rng).total;
  let defense: number;
  if (profile.melee) defense = evasion();
  else {
    // A faixa de distância é medida a partir do JOGADOR: entre dois NPCs vale a maior das duas, senão um
    // aliado parado em "0–6 m" acertaria de graça um atirador a 40 m.
    const band = betweenCombatants(attacker, defender);
    const dv = (rangedDv(attacker.weapon.weaponClass, band) ?? 99) + (defender.cover === 'partial' ? 2 : 0);
    defense = defender.ref >= 8 ? Math.max(dv, evasion()) : dv;
  }
  if (attackTotal <= defense) {
    const line = `${tag(attacker)} ataca ${tag(defender)} e erra.`;
    return { combat: state.combat, result: { attackerId, defenderId, hit: false, line } };
  }
  const dmg = rollDamage(attacker.weapon.damage, rng);
  const r = damageCombatant(defender, dmg, { location: 'body', halfArmor: isArmorPiercingMelee(attacker.weapon.weaponClass), rng });
  const combat = patch(defender.id, t => ({ ...t, hp: { ...t.hp, current: r.application.hpAfter }, sp: { ...t.sp, body: r.application.spAfter }, status: r.statusAfter }));
  const line = `${tag(attacker)} acerta ${tag(defender)}: −${r.application.hpDamage} PV${r.statusAfter === 'down' ? ' — caiu' : ` (${r.application.hpAfter}/${defender.hp.max})`}.`;
  return { combat, result: { attackerId, defenderId, hit: true, hpDamage: r.application.hpDamage, defenderStatusAfter: r.statusAfter, line } };
}

/** DV estimado mostrado ao jogador antes de atacar. */
export function previewAttackDv(weapon: InventoryItem, target: Combatant, mode: AttackMode = 'single'): { dv: number | null; label: string } {
  const cls = weapon.weapon?.weaponClass ?? 'unarmed';
  if (WEAPONS[cls].melee) return { dv: null, label: `Evasão do alvo (${target.evasionBase} + 1d10)` };
  if (target.cover === 'full') return target.coverHp !== undefined ? { dv: rangedDv(cls, target.distance), label: `Cobertura total (${target.coverHp} PV) — o tiro acerta a cobertura` } : { dv: null, label: 'Cobertura total' };
  if (mode === 'autofire') {
    const dv = autofireDv(cls, target.distance);
    if (dv === null) return { dv: null, label: 'Fora do alcance da rajada' };
    const cb = target.cover === 'partial' ? 2 : 0;
    return { dv: dv + cb, label: `DV ${dv + cb} (rajada${cb ? ', meia cobertura +2' : ''})` };
  }
  if (target.distance === 'melee' && !WEAPONS[cls].melee) {
    const dv = rangedDv(cls, 'melee');
    return { dv, label: `DV ${dv} (queima-roupa)` };
  }
  const dv = rangedDv(cls, target.distance);
  if (dv === null) return { dv: null, label: 'Fora do alcance' };
  const coverBonus = target.cover === 'partial' ? 2 : 0;
  return { dv: dv + coverBonus, label: `DV ${dv + coverBonus}${coverBonus ? ' (meia cobertura +2)' : ''}` };
}

export type AttackMode = 'single' | 'autofire' | 'suppressive';
export interface AttackOptions {
  aimedHead?: boolean;
  mode?: AttackMode;
  /** Cadência 2: dois ataques na mesma Ação. */
  twice?: boolean;
  ambush?: boolean;
}

/** Valida arma/munição/modo/alvo. `null` = pode atacar. */
export function attackBlocker(c: Character, weapon: InventoryItem, target: Combatant | undefined, opts: AttackOptions, os: OsSpec | null = null): string | null {
  const cls = weapon.weapon?.weaponClass ?? 'unarmed';
  const profile = WEAPONS[cls];
  const mode = opts.mode ?? 'single';
  if (weapon.weapon?.jammed) return `${weapon.name} está TRAVADA. Destrave (recarregar) antes de atirar.`;
  if (cls === 'martial_arts' && skillValue(c, 'martial_arts') <= 0) return 'Você não treinou Artes Marciais.';
  if (mode !== 'single') {
    if (!profile.autofire) return `${weapon.name} não dispara em rajada (só submetralhadoras e fuzis de assalto).`;
    if ((weapon.weapon?.loaded ?? 0) < 10) return `Rajada/supressão gasta 10 tiros e ${weapon.name} tem ${weapon.weapon?.loaded ?? 0}.`;
  } else if (!profile.melee && !profile.thrown && (weapon.weapon?.loaded ?? 0) <= 0) {
    return `${weapon.name} está descarregada: só um clique seco. Nenhum disparo acontece.`;
  }
  // Sandevistan com tempo dilatado: ataque extra com qualquer arma.
  if (opts.twice && profile.rof !== 2 && !os?.extraAttack) return `${weapon.name} tem Cadência 1 (um ataque por ação).`;
  if (opts.twice && opts.aimedHead && !os?.aimedFollowUp) return 'Dois ataques não combinam com tiro mirado.';
  if (mode === 'suppressive') return null;
  if (!target) return 'Alvo não identificado.';
  if (target.cover === 'full' && (profile.melee || target.coverHp === undefined)) return `${target.name} está atrás de cobertura total.`;
  if (!profile.melee && previewAttackDv(weapon, target, mode).dv === null) return `${target.name} está fora do alcance de ${weapon.name}${mode === 'autofire' ? ' em rajada' : ''}.`;
  return null;
}

/** Monta o pedido de ataque (texto/painel), já validado por attackBlocker. */
export function buildAttackRequest(c: Character, weapon: InventoryItem, target: Combatant | undefined, opts: AttackOptions, origin: RollRequest['origin']): RollRequest {
  const profile = WEAPONS[weapon.weapon?.weaponClass ?? 'unarmed'];
  const mode = opts.mode ?? 'single';
  const what =
    mode === 'suppressive'
      ? 'Fogo de supressão'
      : mode === 'autofire'
        ? 'Rajada'
        : profile.thrown
          ? 'Arremesso'
          : opts.aimedHead
            ? 'Tiro mirado na cabeça'
            : opts.twice
              ? 'Dois ataques'
              : 'Ataque';
  const preview = target ? previewAttackDv(weapon, target, mode) : { dv: 0 };
  return {
    id: makeId('roll'),
    kind: 'attack',
    origin,
    reason: `${opts.ambush ? 'Emboscada — ' : ''}${what} com ${weapon.name}${target && mode !== 'suppressive' ? ` em ${target.name}` : ''}`,
    stat: mode !== 'single' ? 'REF' : profile.melee || profile.thrown ? 'DEX' : 'REF',
    skillId: mode !== 'single' ? 'autofire' : profile.skillId,
    dv: preview.dv ?? 0,
    modifier: 0,
    targetId: target?.id,
    weaponId: weapon.id,
    aimedHead: mode === 'single' ? opts.aimedHead : undefined,
    mode: mode === 'single' ? undefined : mode,
    rof2: opts.twice || undefined,
    ambush: opts.ambush || undefined,
    // Quickhacks ativos no alvo (Ping, Ótica reiniciada, Paralisar Movimento): o jogador acerta com mais facilidade.
    modifiers: target?.hacks?.some(h => h.hitBonus) ? target.hacks.filter(h => h.hitBonus).map(h => ({ label: h.label, value: h.hitBonus! })) : undefined,
  };
}

/** Grau de armas brancas/Artes Marciais: dano pela CORPO (Briga) ou pela arma. */
function damageNotation(c: Character, weapon: InventoryItem, cls: WeaponClass): string {
  if (cls === 'unarmed' || cls === 'martial_arts') {
    const body = unarmedDamage(c.stats.BODY);
    // Ciberbraço: soco mínimo 2d6 (Cyberpunk RED).
    if (c.cyberware.some(cw => defOf(cw)?.foundation?.kind === 'cyberarm') && body === '1d6') return '2d6';
    return body;
  }
  return weapon.weapon?.damage ?? WEAPONS[cls].defaultDamage;
}

/** Aplica um dano já rolado num combatente (armadura, cabeça, ablação, crítico, não letal). */
export function damageCombatant(
  target: Combatant,
  damage: DamageRoll,
  opts: { location: HitLocation; halfArmor: boolean; ablate?: number; nonLethal?: 'stun' | 'rubber'; rng: Rng },
): { application: DamageApplication; statusAfter: CombatantStatus; knockedOut: boolean } {
  const rubber = opts.nonLethal === 'rubber';
  const spBefore = opts.location === 'head' ? target.sp.head : target.sp.body;
  const critical = damage.critical && !rubber;
  const math = computeDamage({ raw: damage.total, sp: spBefore, location: opts.location, halfArmor: opts.halfArmor, critical });
  const ablate = rubber ? 0 : math.ablated ? opts.ablate ?? 1 : 0;
  const spAfter = Math.max(0, spBefore - ablate);
  let hpAfter = Math.max(0, target.hp.current - math.hpDamage);
  // Borracha deixa com pelo menos 1 PV; choque apaga em vez de matar.
  if (rubber) hpAfter = Math.max(1, hpAfter);
  const knockedOut = opts.nonLethal === 'stun' && hpAfter <= 0;
  const application: DamageApplication = {
    location: opts.location,
    raw: damage.total,
    spBefore,
    spAfter,
    throughArmor: math.throughArmor,
    hpDamage: target.hp.current - hpAfter,
    critBonus: math.critBonus,
    hpBefore: target.hp.current,
    hpAfter,
    ablated: spAfter < spBefore,
    criticalInjury: critical ? { id: makeId('inj'), ...randomCriticalInjury(opts.location, opts.rng) } : undefined,
  };
  return { application, statusAfter: hpAfter <= 0 ? 'down' : target.status, knockedOut };
}

const NPC_SAVE_BASE = 2; // perícia média de um NPC em Resistir a Tortura/Drogas e Concentração

/** Efeito especial de granada num alvo (teste de resistência do NPC). */
function grenadeEffect(kind: GrenadeKind, target: Combatant, rng: Rng): { effect?: string; skip?: string; down?: boolean; direct?: number } {
  const save = (dv: number) => (target.will ?? 5) + NPC_SAVE_BASE + rng(10) > dv;
  switch (kind) {
    case 'flashbang':
      return save(15) ? { effect: 'resistiu ao clarão' } : { effect: 'ofuscado e surdo', skip: 'ofuscado pela granada de luz' };
    case 'teargas':
      return save(13) ? { effect: 'resistiu ao gás' } : { effect: 'olhos ardendo', skip: 'cego pelo gás lacrimogêneo' };
    case 'sleep':
      return save(13) ? { effect: 'resistiu ao sonífero' } : { effect: 'desmaiou (sonífero)', down: true };
    case 'poison':
      return save(13) ? { effect: 'resistiu ao veneno' } : { effect: 'envenenado', direct: rng(6) + rng(6) };
    case 'emp':
      return { effect: 'cromo e eletrônicos em pane (1 min)' };
    case 'smoke':
      return { effect: 'encoberto pela fumaça' };
    case 'incendiary':
      return { effect: 'em chamas' };
    default:
      return {};
  }
}

/**
 * Ataque do jogador. Resolve acerto, munição, dano, SP e crítico — e as variações do RED:
 * rajada, fogo de supressão, explosivos em área, granadas especiais, não letal, emboscada,
 * qualidade da arma (ruim trava num 1; excelente +1) e artes marciais.
 */
export function resolvePlayerAttack(state: GameState, request: RollRequest, luckSpent: number, rng: Rng = cryptoRng): RollOutcome {
  const c = state.character;
  const weapon = getPlayerWeapon(c, request.weaponId);
  const cls: WeaponClass = weapon.weapon?.weaponClass ?? 'unarmed';
  const profile = WEAPONS[cls];
  const mode = request.mode ?? 'single';
  const burst = mode === 'autofire' || mode === 'suppressive';
  const target = state.combat.combatants.find(t => t.id === request.targetId && isActiveEnemy(t));
  const stat = burst ? 'REF' : profile.melee || profile.thrown ? 'DEX' : 'REF';
  const skillId = burst ? 'autofire' : profile.skillId;
  const usesAmmo = !profile.melee && !profile.thrown;
  const ammoBefore = usesAmmo ? weapon.weapon?.loaded ?? 0 : null;
  const quality = weapon.weapon?.quality;

  const baseAttack: AttackResult = {
    weaponId: weapon.id,
    weaponName: weapon.name,
    targetId: target?.id ?? request.targetId ?? '',
    targetName: target?.name ?? 'Alvo',
    hit: false,
    ammoBefore,
    ammoAfter: ammoBefore,
    nonLethal: weapon.weapon?.nonLethal,
    grenade: weapon.weapon?.grenade,
    ambush: request.ambush || undefined,
  };

  const mods: Modifier[] = [
    ...(request.modifier ? [{ label: 'Situação', value: request.modifier }] : []),
    ...(request.modifiers ?? []),
    ...effectPenalties(state.activeEffects, stat),
  ];
  if (request.aimedHead && !burst) mods.push({ label: 'Tiro mirado (cabeça)', value: AIMED_SHOT_PENALTY });
  if (weapon.upgrade) mods.push({ label: 'Arma aprimorada', value: 1 });
  if (quality === 'excellent') mods.push({ label: 'Arma excelente', value: 1 });
  if (request.aimedHead && !profile.melee && cyberAimedBonus(c)) mods.push({ label: 'Mira Telescópica', value: cyberAimedBonus(c) });
  if (!profile.melee && cyberLongRangeBonus(c) && target?.distance === '51-100m') mods.push({ label: 'TeleÓptica', value: cyberLongRangeBonus(c) });
  const precision = soloValue(c, 'precision');
  if (precision) mods.push({ label: 'Ataque Preciso', value: precision });
  // Perdeu a Encarada para este alvo: −2 contra ele.
  if (target?.facedown === 'npc') mods.push({ label: 'Perdeu a Encarada', value: -2 });
  const os = activeOs(state);
  const osName = installedOs(c)?.def.name ?? 'Cromo';
  if (os?.toHit && (os.kind === 'sandevistan' || profile.melee)) mods.push({ label: osName, value: os.toHit });

  const failWith = (failure: AttackResult['failure'], dv: number): RollOutcome => ({
    request,
    check: { stat, statValue: statValue(c, stat), skillId, skillValue: skillValue(c, skillId), d10: { rolls: [], natural: 0, total: 0, crit: false, fumble: false }, modifiers: mods, luckSpent: 0, total: 0, dv, success: false, margin: -dv },
    attack: { ...baseAttack, failure },
  });

  if (weapon.weapon?.jammed) return failWith('jammed', request.dv);
  if (usesAmmo && (ammoBefore ?? 0) < (burst ? 10 : 1)) return failWith('no_ammo', request.dv);
  if (burst && !profile.autofire) return failWith('no_target', request.dv);

  // ---------------------------------------------------------------- fogo de supressão
  if (mode === 'suppressive') {
    const check = resolveCheck(c, { stat: 'REF', skillId: 'autofire', dv: 0, modifiers: mods, luckSpent, ignoreFumble: soloValue(c, 'fumbleRecovery') > 0 }, rng);
    const suppression = state.combat.combatants
      .filter(t => isActiveEnemy(t) && t.cover !== 'full' && BRACKET_NEAR_EDGE[t.distance] <= 25)
      .map(t => ({ id: t.id, name: t.name, held: (t.will ?? 5) + NPC_SAVE_BASE + rng(10) > check.total }));
    const jammed = quality === 'poor' && check.d10.natural === 1;
    const attack: AttackResult = { ...baseAttack, hit: !jammed, ammoAfter: (ammoBefore ?? 0) - 10, ammoUsed: 10, suppression: jammed ? [] : suppression, jammedNow: jammed || undefined, targetName: 'área' };
    return { request: { ...request, dv: 0 }, check: { ...check, success: !jammed, margin: 0 }, attack };
  }

  if (!target) return failWith('no_target', request.dv);

  // Cobertura total: dá para atirar NA cobertura (ela tem PV) — sem acertar quem está atrás.
  const shootingCover = target.cover === 'full';
  if (shootingCover && (profile.melee || target.coverHp === undefined)) return failWith('in_cover', request.dv);

  let dv: number;
  const dodge = () => target.evasionBase + rollD10(rng).total;
  if (profile.melee) {
    if (target.distance !== 'melee') {
      if (moveMeters(movementValue(c)) < BRACKET_NEAR_EDGE[target.distance]) return failWith('out_of_range', request.dv);
      baseAttack.closedIn = true;
    }
    // Alvo desprevenido (emboscada) não esquiva: DV Simples.
    dv = request.ambush ? 9 : dodge();
  } else {
    const base = burst ? autofireDv(cls, target.distance) : rangedDv(cls, target.distance);
    if (base === null) return failWith('out_of_range', request.dv);
    dv = base + (target.cover === 'partial' ? 2 : 0);
    // REF 8+ esquiva de projéteis (não de explosivos — estes se esquiva depois, saindo da área).
    if (target.ref >= 8 && !profile.area && !request.ambush && !shootingCover) dv = Math.max(dv, dodge());
  }

  const check = resolveCheck(c, { stat, skillId, dv, modifiers: mods, luckSpent, ignoreFumble: soloValue(c, 'fumbleRecovery') > 0 }, rng);
  const jammedNow = quality === 'poor' && check.d10.natural === 1;
  const ammoUsed = usesAmmo ? (burst ? 10 : 1) : 0;
  const attack: AttackResult = {
    ...baseAttack,
    hit: check.success && !jammedNow,
    ammoAfter: usesAmmo ? Math.max(0, (ammoBefore ?? 0) - ammoUsed) : null,
    ammoUsed: ammoUsed || undefined,
    jammedNow: jammedNow || undefined,
    thrown: profile.thrown || undefined,
  };
  if (jammedNow) return { request: { ...request, dv }, check: { ...check, success: false }, attack };
  if (!attack.hit) return { request: { ...request, dv }, check, attack };

  const location: HitLocation = request.aimedHead && !burst && !profile.area ? 'head' : 'body';
  const notation = damageNotation(c, weapon, cls);

  // ---------------------------------------------------------------- tiro na cobertura
  if (shootingCover) {
    const dmg = rollDamage(notation, rng);
    const before = target.coverHp ?? 0;
    attack.damage = dmg;
    attack.coverDamage = { before, after: Math.max(0, before - dmg.total) };
    return { request: { ...request, dv }, check, attack };
  }

  // ---------------------------------------------------------------- explosivo em área
  if (profile.area) {
    const kind: GrenadeKind = weapon.weapon?.grenade ?? 'basic';
    const damaging = !['flashbang', 'sleep', 'smoke', 'teargas', 'poison', 'emp'].includes(kind);
    const dmg = rollDamage(notation, rng);
    attack.damage = dmg;
    const inArea = state.combat.combatants.filter(t => t.status === 'active' && (t.id === target.id || t.distance === target.distance));
    attack.areaHits = inArea.map(t => {
      // Quem tem REF 8+ pode pular para fora da área.
      const dodged = t.ref >= 8 && t.evasionBase + rollD10(rng).total > check.total;
      if (dodged) return { targetId: t.id, name: t.name, dodged: true };
      const special = grenadeEffect(kind, t, rng);
      if (!damaging) {
        const hpAfter = special.direct ? Math.max(0, t.hp.current - special.direct) : t.hp.current;
        const statusAfter: CombatantStatus = special.down || hpAfter <= 0 ? 'down' : t.status;
        const application = special.direct ? { location: 'body' as const, raw: special.direct, spBefore: t.sp.body, spAfter: t.sp.body, throughArmor: special.direct, hpDamage: special.direct, critBonus: 0, hpBefore: t.hp.current, hpAfter, ablated: false } : undefined;
        return { targetId: t.id, name: t.name, dodged: false, application, statusAfter, effect: special.effect };
      }
      const r = damageCombatant(t, dmg, { location: 'body', halfArmor: false, ablate: kind === 'armor_piercing' ? 2 : 1, rng });
      return { targetId: t.id, name: t.name, dodged: false, application: r.application, statusAfter: r.statusAfter, effect: special.effect };
    });
    const main = attack.areaHits.find(h => h.targetId === target.id);
    if (main?.application) {
      attack.application = main.application;
      attack.targetStatusAfter = main.statusAfter;
    }
    return { request: { ...request, dv }, check, attack };
  }

  // ---------------------------------------------------------------- tiro/golpe único ou rajada
  let damage: DamageRoll;
  if (mode === 'autofire') {
    // Rajada: 2d6 × (quanto passou do DV), até o multiplicador da arma.
    const mult = Math.max(1, Math.min(profile.autofire!.mult, check.margin));
    const base = rollDamage('2d6', rng);
    damage = { ...base, notation: `2d6×${mult}`, total: base.total * mult };
    attack.autofireMult = mult;
  } else {
    damage = rollDamage(notation, rng);
  }
  const weak = state.combat.roleUsage?.spotWeaknessRound === state.combat.round ? 0 : soloValue(c, 'spotWeakness');
  if (weak) {
    damage = { ...damage, total: damage.total + weak };
    attack.spotWeakness = weak;
  }
  // Berserk: fúria no corpo a corpo.
  if (os?.meleeDamage && profile.melee) damage = { ...damage, total: damage.total + os.meleeDamage };
  const r = damageCombatant(target, damage, { location, halfArmor: isArmorPiercingMelee(cls), nonLethal: weapon.weapon?.nonLethal, rng });
  attack.damage = damage;
  attack.application = r.application;
  attack.targetStatusAfter = r.statusAfter;
  attack.knockedOut = r.knockedOut || undefined;
  return { request: { ...request, dv }, check, attack };
}

/** Aplica o resultado de um ataque do jogador ao estado de combate e à arma. */
export function applyPlayerAttack(state: GameState, attack: AttackResult): { character: Character; combat: CombatState } {
  let inventory = state.character.inventory.map(i => {
    if (i.id !== attack.weaponId || !i.weapon) return i;
    let w = i.weapon;
    if (attack.ammoAfter !== null && attack.ammoAfter !== attack.ammoBefore) w = { ...w, loaded: attack.ammoAfter ?? 0 };
    if (attack.jammedNow) w = { ...w, jammed: true };
    return { ...i, weapon: w };
  });
  // Granada arremessada: consome uma unidade.
  if (attack.thrown && !attack.failure) inventory = inventory.map(i => (i.id === attack.weaponId ? { ...i, quantity: i.quantity - 1 } : i)).filter(i => i.quantity > 0);
  const character: Character = { ...state.character, inventory };

  const patch = new Map<string, (t: Combatant) => Combatant>();
  const add = (id: string, fn: (t: Combatant) => Combatant) => {
    const prev = patch.get(id);
    patch.set(id, prev ? t => fn(prev(t)) : fn);
  };
  const applyDamage = (id: string, app: DamageApplication, statusAfter?: CombatantStatus) =>
    add(id, t => ({ ...t, hp: { ...t.hp, current: app.hpAfter }, sp: app.location === 'head' ? { ...t.sp, head: app.spAfter } : { ...t.sp, body: app.spAfter }, status: statusAfter ?? t.status }));

  if (attack.areaHits) {
    for (const h of attack.areaHits) {
      if (h.application) applyDamage(h.targetId, h.application, h.statusAfter);
      else if (h.statusAfter && h.statusAfter !== 'active') add(h.targetId, t => ({ ...t, status: h.statusAfter! }));
      if (h.effect && /ofuscado|cego|olhos/.test(h.effect)) add(h.targetId, t => ({ ...t, skipNextAttack: h.effect }));
      if (h.effect === 'desmaiou (sonífero)') add(h.targetId, t => ({ ...t, conditions: setCondition(t.conditions, 'unconscious', true, state.turn, 'sonífero') }));
      if (h.effect === 'encoberto pela fumaça') add(h.targetId, t => ({ ...t, cover: t.cover === 'none' ? 'partial' : t.cover }));
    }
  } else if (attack.application) {
    applyDamage(attack.targetId, attack.application, attack.targetStatusAfter);
  }
  if (attack.knockedOut) add(attack.targetId, t => ({ ...t, status: 'down', conditions: setCondition(t.conditions, 'unconscious', true, state.turn, 'nocauteado') }));
  if (attack.coverDamage) add(attack.targetId, t => ({ ...t, coverHp: attack.coverDamage!.after, cover: attack.coverDamage!.after <= 0 ? 'none' : t.cover }));
  if (attack.closedIn) add(attack.targetId, t => ({ ...t, distance: 'melee' }));
  for (const s of attack.suppression ?? []) if (!s.held) add(s.id, t => ({ ...t, skipNextAttack: 'suprimido: mergulhou na cobertura', cover: t.cover === 'none' ? 'partial' : t.cover }));
  // Emboscada: os inimigos ainda desprevenidos perdem a próxima ação.
  if (attack.ambush && attack.hit) for (const t of state.combat.combatants) if (isActiveEnemy(t)) add(t.id, x => ({ ...x, skipNextAttack: x.skipNextAttack ?? 'pego de surpresa' }));

  const combat: CombatState = patch.size ? { ...state.combat, combatants: state.combat.combatants.map(t => patch.get(t.id)?.(t) ?? t) } : state.combat;
  return { character, combat };
}

/**
 * Ataque de um inimigo contra o jogador.
 * Distância: DV da tabela; se REF do jogador ≥ 8, ele pode esquivar (vale o maior).
 * Corpo a corpo: rolagem de Evasão do jogador.
 */
export function resolveEnemyAttack(state: GameState, attackerId: string, rng: Rng = cryptoRng): { result: EnemyAttackResult; character: Character } | null {
  // Só um INIMIGO de pé ataca o jogador (aliado nunca, nem por enemyActions do narrador).
  const attacker = state.combat.combatants.find(t => t.id === attackerId && isActiveEnemy(t));
  if (!attacker) return null;
  const c = state.character;
  const profile = WEAPONS[attacker.weapon.weaponClass];

  // Inconsciente ou amarrado: não age (a condição continua; não é consumida como o skipNextAttack).
  const blocked = combatantCannotAct(attacker);
  if (blocked) {
    return { result: { attackerId, attackerName: attacker.name, attackTotal: 0, defenseTotal: 0, defenseKind: 'dv', hit: false, skipped: blocked }, character: c };
  }
  // Suprimido, ofuscado, emboscado ou destravando a arma: perde este ataque.
  if (attacker.skipNextAttack) {
    return { result: { attackerId, attackerName: attacker.name, attackTotal: 0, defenseTotal: 0, defenseKind: 'dv', hit: false, skipped: attacker.skipNextAttack }, character: c };
  }
  const attackRoll = rollD10(rng);
  // Arma ruim trava num 1 natural.
  if (attacker.weapon.quality === 'poor' && !profile.melee && attackRoll.natural === 1) {
    return { result: { attackerId, attackerName: attacker.name, attackTotal: 0, defenseTotal: 0, defenseKind: 'dv', hit: false, jammed: true }, character: c };
  }
  // Agarrado (pelo jogador ou por alguém): −2 em todas as ações. Perdeu a Encarada para o jogador: −2.
  const grappledPenalty = (attacker.conditions ?? []).some(x => x.key === 'grappled') ? -2 : 0;
  const facedownPenalty = attacker.facedown === 'player' ? -2 : 0;
  const os = activeOs(state);
  // Quickhacks no atacante (Choque Sônico, Pane de Cromo, Ciberpsicose): penalidade nos ataques dele.
  const hackPenalty = (attacker.hacks ?? []).reduce((n, h) => n + (h.attackMod ?? 0), 0);
  const attackTotal = attacker.attackBase + attackRoll.total + grappledPenalty + facedownPenalty + hackPenalty + (attacker.weapon.quality === 'excellent' ? 1 : 0) - (os?.enemyPenalty ?? 0);

  const evasionPenalty = checkPenalties(c, 'DEX').reduce((s, m) => s + m.value, 0);
  const evasionTotal = () => statValue(c, 'DEX') + skillValue(c, 'evasion') + rollD10(rng).total + evasionPenalty + (os?.evade ?? 0);
  // REF 8+ esquiva de balas; Sandevistan e Kerenzikov militar também.
  const dodgesBullets = c.stats.REF >= 8 || !!os?.dodgeBullets || cyberDodgeBullets(c);

  let defenseTotal: number;
  let defenseKind: EnemyAttackResult['defenseKind'];
  if (profile.melee) {
    defenseTotal = evasionTotal();
    defenseKind = 'evasion';
  } else {
    const dv = rangedDv(attacker.weapon.weaponClass, attacker.distance) ?? 99;
    if (dodgesBullets) {
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

  // Escudo humano: tiros (não golpes corpo a corpo) acertam o agarrado — ou o cadáver dele.
  const shieldRef = c.humanShield;
  const shieldFoe = shieldRef ? state.combat.combatants.find(t => t.id === shieldRef.id) : undefined;
  if (shieldRef && shieldFoe && !profile.melee && attacker.id !== shieldFoe.id) {
    if (shieldFoe.status === 'dead') {
      const left = Math.max(0, (shieldRef.corpseHp ?? shieldFoe.body ?? 4) - damage.total);
      return { result: { ...result, damage, shield: { id: shieldFoe.id, name: shieldFoe.name, hpDamage: damage.total, corpse: true, destroyed: left <= 0 } }, character: c };
    }
    const math = computeDamage({ raw: damage.total, sp: shieldFoe.sp.body, location: 'body', critical: damage.critical });
    return { result: { ...result, damage, shield: { id: shieldFoe.id, name: shieldFoe.name, hpDamage: math.hpDamage, corpse: false, destroyed: false } }, character: c };
  }

  const applied = applyDamageToCharacter(c, damage, 'body', { halfArmor: isArmorPiercingMelee(attacker.weapon.weaponClass), rng });
  // Desvio de Dano (Solo): reduz o primeiro dano sofrido em cada rodada. Berserk/Editor de Dor Mk.2: todo dano.
  const deflect = state.combat.roleUsage?.deflectionRound === state.combat.round ? 0 : soloValue(c, 'deflection');
  const reduce = (os?.damageReduction ?? 0) + cyberDamageReduction(c);
  if ((deflect || reduce) && applied.application.hpDamage > 0) {
    const afterDeflect = Math.max(0, applied.application.hpDamage - deflect);
    const hpDamage = Math.max(0, afterDeflect - reduce);
    const application = { ...applied.application, hpDamage, hpAfter: Math.max(0, c.hp.current - hpDamage) };
    const deflected = applied.application.hpDamage - afterDeflect;
    return { result: { ...result, damage, application, deflected: deflected || undefined, reduced: afterDeflect - hpDamage || undefined }, character: applyDamageApplication(c, application) };
  }
  return { result: { ...result, damage, application: applied.application }, character: applied.character };
}

/** MOVE efetivo (penalidades de armadura pesada, ferimento mortal, efeitos). */
export function movementValue(c: Character): number {
  return Math.max(0, statValue(c, 'MOVE') + checkPenalties(c, 'MOVE').reduce((s, m) => s + m.value, 0));
}

/** Iniciativa: REF + 1d10 para todos. */
export function rollInitiative(state: GameState, rng: Rng = cryptoRng): { player: number; enemies: Array<{ id: string; value: number }>; die: number; modifiers: Modifier[] } {
  const die = rng(10);
  // Penalidades de REF (armadura pesada, ferimentos) valem para a iniciativa; Reação de Iniciativa (Solo) soma.
  const reaction = soloValue(state.character, 'initiative');
  const modifiers = [...checkPenalties(state.character, 'REF'), ...(reaction ? [{ label: 'Reação de Iniciativa', value: reaction }] : []), ...cyberInitiative(state)];
  return {
    player: statValue(state.character, 'REF') + modifiers.reduce((s, m) => s + m.value, 0) + die,
    enemies: state.combat.combatants.filter(t => t.status === 'active').map(e => ({ id: e.id, value: e.ref + rng(10) })),
    die,
    modifiers,
  };
}

/** Ordem de turno (maior iniciativa primeiro). */
export function turnOrder(combat: CombatState): Array<{ id: string; name: string; initiative: number | null; isPlayer: boolean }> {
  const rows = [
    { id: 'player', name: 'Você', initiative: combat.playerInitiative, isPlayer: true },
    ...combat.combatants.filter(t => t.status === 'active').map(t => ({ id: t.id, name: isAlly(t) ? `${t.name} (aliado)` : t.name, initiative: t.initiative, isPlayer: false })),
  ];
  return rows.sort((a, b) => (b.initiative ?? -99) - (a.initiative ?? -99));
}

/** Recarga: consome munição do inventário pelo tipo exato. */
export function reloadWeapon(c: Character, weaponId: string): { character: Character; loadedRounds: number } | { error: string } {
  const weapon = c.inventory.find(i => i.id === weaponId);
  if (weapon?.weapon?.jammed) {
    // Destravar custa a ação de recarga (a munição do pente fica).
    const inventory = c.inventory.map(i => (i.id === weapon.id && i.weapon ? { ...i, weapon: { ...i.weapon, jammed: false } } : i));
    return { character: { ...c, inventory }, loadedRounds: 0 };
  }
  if (!weapon?.weapon || weapon.weapon.magSize === null || !weapon.weapon.ammo) return { error: 'Esta arma não usa munição.' };
  const needed = weapon.weapon.magSize - weapon.weapon.loaded;
  if (needed <= 0) return { error: 'O pente já está cheio.' };
  // Prefere a mesma munição que já está no pente (borracha × comum).
  const current = weapon.weapon.nonLethal === 'rubber' ? 'rubber' : undefined;
  const fits = c.inventory.filter(i => i.category === 'ammo' && i.ammoKind === weapon.weapon!.ammo && i.quantity > 0);
  const ammoItem = fits.find(i => i.ammoVariant === current) ?? fits[0];
  if (!ammoItem) return { error: 'Sem munição compatível no inventário.' };
  const nonLethal = ammoItem.ammoVariant === 'rubber' ? ('rubber' as const) : weapon.weapon.nonLethal === 'stun' ? ('stun' as const) : undefined;
  const moved = Math.min(needed, ammoItem.quantity);
  const inventory = c.inventory
    .map(i => {
      if (i.id === weapon.id && i.weapon) return { ...i, weapon: { ...i.weapon, loaded: i.weapon.loaded + moved, nonLethal } };
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
