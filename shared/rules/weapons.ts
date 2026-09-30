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
  /** Cadência (RED): ROF 2 = dois ataques na mesma Ação (não vale para tiro mirado). */
  rof: 1 | 2;
  /** Rajada: multiplicador máximo e tabela de DV própria (10 tiros por rajada). */
  autofire?: { mult: number; dvs: Record<Exclude<DistanceBracket, 'melee'>, number | null> };
  /** Explosivo: atinge a área (10 × 10 m) — todos os alvos na mesma faixa de distância. */
  area?: boolean;
  /** Arremessada (granada): usa DEX + Atletismo e gasta o próprio item. */
  thrown?: boolean;
  /** Ignora metade da SP (armas brancas, Artes Marciais). */
  halfArmor?: boolean;
}

const PISTOL_DVS = { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30 } as const;

const SMG_AUTO = { '0-6m': 20, '7-12m': 17, '13-25m': 20, '26-50m': 25, '51-100m': 30 } as const;
const AR_AUTO = { '0-6m': 22, '7-12m': 20, '13-25m': 17, '26-50m': 20, '51-100m': 25 } as const;

export const WEAPONS: Record<WeaponClass, WeaponProfile> = {
  unarmed: { id: 'unarmed', label: 'Desarmado', skillId: 'brawling', defaultDamage: '1d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 2 },
  martial_arts: { id: 'martial_arts', label: 'Artes Marciais', skillId: 'martial_arts', defaultDamage: '1d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 2, halfArmor: true },
  melee_light: { id: 'melee_light', label: 'Arma branca leve', skillId: 'melee_weapon', defaultDamage: '1d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 2, halfArmor: true },
  melee_medium: { id: 'melee_medium', label: 'Arma branca média', skillId: 'melee_weapon', defaultDamage: '2d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 2, halfArmor: true },
  melee_heavy: { id: 'melee_heavy', label: 'Arma branca pesada', skillId: 'melee_weapon', defaultDamage: '3d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 2, halfArmor: true },
  melee_vheavy: { id: 'melee_vheavy', label: 'Arma branca muito pesada', skillId: 'melee_weapon', defaultDamage: '4d6', melee: true, ammo: null, defaultMag: null, dvs: null, rof: 1, halfArmor: true },
  pistol_medium: { id: 'pistol_medium', label: 'Pistola média', skillId: 'handgun', defaultDamage: '2d6', melee: false, ammo: 'M_PISTOL', defaultMag: 12, dvs: { ...PISTOL_DVS }, rof: 2 },
  pistol_heavy: { id: 'pistol_heavy', label: 'Pistola pesada', skillId: 'handgun', defaultDamage: '3d6', melee: false, ammo: 'H_PISTOL', defaultMag: 8, dvs: { ...PISTOL_DVS }, rof: 2 },
  pistol_vheavy: { id: 'pistol_vheavy', label: 'Pistola muito pesada', skillId: 'handgun', defaultDamage: '4d6', melee: false, ammo: 'VH_PISTOL', defaultMag: 8, dvs: { ...PISTOL_DVS }, rof: 1 },
  smg: { id: 'smg', label: 'Submetralhadora', skillId: 'handgun', defaultDamage: '2d6', melee: false, ammo: 'M_PISTOL', defaultMag: 30, dvs: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 20, '51-100m': 25 }, rof: 1, autofire: { mult: 3, dvs: { ...SMG_AUTO } } },
  heavy_smg: { id: 'heavy_smg', label: 'Submetralhadora pesada', skillId: 'handgun', defaultDamage: '3d6', melee: false, ammo: 'H_PISTOL', defaultMag: 40, dvs: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 20, '51-100m': 25 }, rof: 1, autofire: { mult: 3, dvs: { ...SMG_AUTO } } },
  shotgun: { id: 'shotgun', label: 'Escopeta', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'SLUG', defaultMag: 4, dvs: { '0-6m': 13, '7-12m': 15, '13-25m': 20, '26-50m': 25, '51-100m': 30 }, rof: 1 },
  assault_rifle: { id: 'assault_rifle', label: 'Fuzil de assalto', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'RIFLE', defaultMag: 25, dvs: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 13, '51-100m': 15 }, rof: 1, autofire: { mult: 4, dvs: { ...AR_AUTO } } },
  sniper_rifle: { id: 'sniper_rifle', label: 'Fuzil de precisão', skillId: 'shoulder_arms', defaultDamage: '5d6', melee: false, ammo: 'RIFLE', defaultMag: 4, dvs: { '0-6m': 30, '7-12m': 25, '13-25m': 25, '26-50m': 20, '51-100m': 15 }, rof: 1 },
  bow: { id: 'bow', label: 'Arco/Besta', skillId: 'archery', defaultDamage: '4d6', melee: false, ammo: 'ARROW', defaultMag: 1, dvs: { '0-6m': 15, '7-12m': 13, '13-25m': 15, '26-50m': 17, '51-100m': 20 }, rof: 1 },
  grenade: { id: 'grenade', label: 'Granada', skillId: 'athletics', defaultDamage: '6d6', melee: false, ammo: null, defaultMag: null, dvs: { '0-6m': 16, '7-12m': 15, '13-25m': 15, '26-50m': null, '51-100m': null }, rof: 1, area: true, thrown: true },
  grenade_launcher: { id: 'grenade_launcher', label: 'Lança-granadas', skillId: 'heavy_weapons', defaultDamage: '6d6', melee: false, ammo: 'GRENADE', defaultMag: 2, dvs: { '0-6m': 16, '7-12m': 15, '13-25m': 15, '26-50m': 17, '51-100m': 20 }, rof: 1, area: true },
  rocket_launcher: { id: 'rocket_launcher', label: 'Lança-foguetes', skillId: 'heavy_weapons', defaultDamage: '8d6', melee: false, ammo: 'ROCKET', defaultMag: 1, dvs: { '0-6m': 17, '7-12m': 16, '13-25m': 15, '26-50m': 15, '51-100m': 20 }, rof: 1, area: true },
};

export const AMMO_LABEL: Record<AmmoKind, string> = {
  M_PISTOL: 'Munição de Pistola Média',
  H_PISTOL: 'Munição de Pistola Pesada',
  VH_PISTOL: 'Munição de Pistola Muito Pesada',
  SLUG: 'Balote de Escopeta',
  RIFLE: 'Munição de Fuzil',
  ARROW: 'Flechas',
  GRENADE: 'Granadas de lançador',
  ROCKET: 'Foguetes',
};

export function isWeaponClass(value: unknown): value is WeaponClass {
  return typeof value === 'string' && value in WEAPONS;
}

/** Borda mais próxima de cada faixa (m): quanto é preciso andar para colar no alvo. */
export const BRACKET_NEAR_EDGE: Record<DistanceBracket, number> = { melee: 0, '0-6m': 0, '7-12m': 7, '13-25m': 13, '26-50m': 26, '51-100m': 51 };

/** Faixa em que um alvo a `meters` de distância cai. */
export function bracketFor(meters: number): DistanceBracket {
  if (meters <= 1) return 'melee';
  if (meters <= 6) return '0-6m';
  if (meters <= 12) return '7-12m';
  if (meters <= 25) return '13-25m';
  if (meters <= 50) return '26-50m';
  return '51-100m';
}

/** Cyberpunk RED: a Ação de Movimento cobre MOVE × 2 metros por turno. */
export const moveMeters = (move: number) => Math.max(0, move) * 2;

export function isDistanceBracket(value: unknown): value is DistanceBracket {
  return typeof value === 'string' && (ALL_BRACKETS as readonly string[]).includes(value);
}

/** Heurística para classificar armas descritas livremente pelo GM. */
export function guessWeaponClass(name: string, damage?: string): WeaponClass {
  const n = name.toLowerCase();
  if (/foguete|rocket|bazuca/.test(n)) return 'rocket_launcher';
  if (/lança-granada|lanca-granada|grenade launcher/.test(n)) return 'grenade_launcher';
  if (/granada/.test(n)) return 'grenade';
  if (/marreta|motosserra|naginata/.test(n)) return 'melee_vheavy';
  if (/sniper|precis/.test(n)) return 'sniper_rifle';
  if (/escopeta|espingarda|shotgun|doze|calibre 12/.test(n)) return 'shotgun';
  if (/fuzil|assalto|rifle|kalash|ronin/.test(n)) return 'assault_rifle';
  if (/(smg|submetralhadora).*pesad|heavy smg/.test(n)) return 'heavy_smg';
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

/** Armas brancas e Artes Marciais ignoram metade da SP; soco/chute (Briga) não. */
export function isArmorPiercingMelee(weaponClass: WeaponClass): boolean {
  return !!WEAPONS[weaponClass].halfArmor;
}

/** DV de rajada (tabela própria do RED). null = sem rajada ou fora do alcance. */
export function autofireDv(weaponClass: WeaponClass, distance: DistanceBracket): number | null {
  const a = WEAPONS[weaponClass].autofire;
  if (!a) return null;
  return a.dvs[distance === 'melee' ? '0-6m' : distance];
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
