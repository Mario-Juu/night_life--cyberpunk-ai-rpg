/**
 * Balística e armas — Cyberpunk RED (livro básico, tabela de DV por distância).
 * Conferir valores com o livro se houver divergência de edição.
 */
import type { AmmoKind, DistanceBracket, WeaponClass } from '../types/game';

export const RANGED_BRACKETS: readonly Exclude<DistanceBracket, 'melee'>[] = ['0-6m', '7-12m', '13-25m', '26-50m', '51-100m'];
export const ALL_BRACKETS: readonly DistanceBracket[] = ['melee', ...RANGED_BRACKETS];

export const DISTANCE_LABEL: Record<DistanceBracket, string> = {
  melee: 'Corpo a corpo',
  '0-6m': '0–6 m',
  '7-12m': '7–12 m',
  '13-25m': '13–25 m',
  '26-50m': '26–50 m',
  '51-100m': '51–100 m',
};

export interface WeaponProfile {
  id: WeaponClass;
  label: string;
  skillId: string;
  defaultDamage: string;
  melee: boolean;
  ammo: AmmoKind | null;
  defaultMag: number | null;
  /** DV por faixa. null = fora do alcance efetivo. */
  dvs: Record<Exclude<DistanceBracket, 'melee'>, number | null> | null;
}

const PISTOL_DVS = { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30 } as const;

export const WEAPONS: Record<WeaponClass, WeaponProfile> = {
  unarmed: { id: 'unarmed', label: 'Desarmado', skillId: 'brawling', defaultDamage: '1d6', melee: true, ammo: null, defaultMag: null, dvs: null },
  melee_light: { id: 'melee_light', label: 'Arma branca leve', skillId: 'melee_weapon', defaultDamage: '1d6', melee: true, ammo: null, defaultMag: null, dvs: null },
  melee_medium: { id: 'melee_medium', label: 'Arma branca média', skillId: 'melee_weapon', defaultDamage: '2d6', melee: true, ammo: null, defaultMag: null, dvs: null },
  melee_heavy: { id: 'melee_heavy', label: 'Arma branca pesada', skillId: 'melee_weapon', defaultDamage: '3d6', melee: true, ammo: null, defaultMag: null, dvs: null },
  pistol_medium: { id: 'pistol_medium', label: 'Pistola média', skillId: 'handgun', defaultDamage: '2d6', melee: false, ammo: 'M_PISTOL', defaultMag: 12, dvs: { ...PISTOL_DVS } },
  pistol_heavy: { id: 'pistol_heavy', label: 'Pistola pesada', skillId: 'handgun', defaultDamage: '3d6', melee: false, ammo: 'H_PISTOL', defaultMag: 8, dvs: { ...PISTOL_DVS } },
  pistol_vheavy: { id: 'pistol_vheavy', label: 'Pistola muito pesada', skillId: 'handgun', defaultDamage: '4d6', melee: false, ammo: 'VH_PISTOL', defaultMag: 8, dvs: { ...PISTOL_DVS } },
  smg: { id: 'smg', label: 'Submetralhadora', skillId: 'handgun', defaultDamage: '2d6', melee: false, ammo: 'M_PISTOL', defaultMag: 30, dvs: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 20, '51-100m': 25 } },
  shotgun: { id: 'shotgun', label: 'Escopeta', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'SLUG', defaultMag: 4, dvs: { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30 } },
  assault_rifle: { id: 'assault_rifle', label: 'Fuzil de assalto', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'RIFLE', defaultMag: 25, dvs: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 13, '51-100m': 15 } },
  sniper_rifle: { id: 'sniper_rifle', label: 'Fuzil de precisão', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'RIFLE', defaultMag: 4, dvs: { '0-6m': 30, '7-12m': 25, '13-25m': 25, '26-50m': 20, '51-100m': 15 } },
  bow: { id: 'bow', label: 'Arco/Besta', skillId: 'archery', defaultDamage: '4d6', melee: false, ammo: 'ARROW', defaultMag: 1, dvs: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 17, '51-100m': 20 } },
};

export const AMMO_LABEL: Record<AmmoKind, string> = {
  M_PISTOL: 'Munição de Pistola Média',
  H_PISTOL: 'Munição de Pistola Pesada',
  VH_PISTOL: 'Munição de Pistola Muito Pesada',
  SLUG: 'Balote de Escopeta',
  RIFLE: 'Munição de Fuzil',
  ARROW: 'Flechas',
};

export function isWeaponClass(value: unknown): value is WeaponClass {
  return typeof value === 'string' && value in WEAPONS;
}

export function isDistanceBracket(value: unknown): value is DistanceBracket {
  return typeof value === 'string' && (ALL_BRACKETS as readonly string[]).includes(value);
}

/** Heurística para classificar armas descritas livremente pelo GM. */
export function guessWeaponClass(name: string, damage?: string): WeaponClass {
  const n = name.toLowerCase();
  if (/sniper|precis/.test(n)) return 'sniper_rifle';
  if (/escopeta|espingarda|shotgun|doze|calibre 12/.test(n)) return 'shotgun';
  if (/fuzil|assalto|rifle|kalash|ronin/.test(n)) return 'assault_rifle';
  if (/smg|submetralhadora|uzi|metralhadora/.test(n)) return 'smg';
  if (/arco|besta|bow/.test(n)) return 'bow';
  if (/katana|machete|taco|bastão|marreta|machado/.test(n)) return damage === '3d6' ? 'melee_heavy' : 'melee_medium';
  if (/faca|lâmina|canivete|navalha|soqueira/.test(n)) return 'melee_light';
  if (/soco|punho|desarmad/.test(n)) return 'unarmed';
  if (damage === '4d6') return 'pistol_vheavy';
  if (damage === '3d6') return 'pistol_heavy';
  return 'pistol_medium';
}

/** DV de ataque à distância. Retorna null se fora do alcance. */
export function rangedDv(weaponClass: WeaponClass, distance: DistanceBracket): number | null {
  const profile = WEAPONS[weaponClass];
  if (profile.melee || !profile.dvs) return null;
  if (distance === 'melee') return profile.dvs['0-6m'];
  return profile.dvs[distance];
}

/** Armas brancas perfuram armadura (ignoram metade da SP); soco/chute (Briga) não. */
export function isArmorPiercingMelee(weaponClass: WeaponClass): boolean {
  return WEAPONS[weaponClass].melee && weaponClass !== 'unarmed';
}

/** Dano desarmado (Briga) depende do BODY — Cyberpunk RED. */
export function unarmedDamage(body: number): string {
  if (body >= 11) return '4d6';
  if (body >= 7) return '3d6';
  if (body >= 5) return '2d6';
  return '1d6';
}

/** Penalidade de armadura pesada (em REF, DEX e MOVE) pela SP da peça — Cyberpunk RED. */
export function armorPenalty(sp: number): number {
  if (sp >= 15) return -4; // flak, metalgear
  if (sp >= 12) return -2; // armorjack médio/pesado
  return 0;
}

/** Penalidade para mirar na cabeça (Cyberpunk RED: tiro mirado −8). */
export const AIMED_SHOT_PENALTY = -8;
