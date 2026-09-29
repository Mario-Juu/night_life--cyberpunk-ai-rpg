/**
 * Tabela de preços de referência (Cyberpunk RED, valores de mercado de rua).
 * O motor usa estes preços em compras — o LLM não define quanto algo custa quando há referência.
 */
import type { AmmoKind, HitLocation, ItemCategory, WeaponClass } from '../types/game';

export const WEAPON_PRICES: Record<WeaponClass, number> = {
  unarmed: 0,
  melee_light: 50,
  melee_medium: 50,
  melee_heavy: 100,
  pistol_medium: 50,
  pistol_heavy: 100,
  pistol_vheavy: 100,
  smg: 100,
  shotgun: 500,
  assault_rifle: 500,
  sniper_rifle: 500,
  bow: 100,
};

/** Preço por UNIDADE de munição (pacotes de 10 custam 10×). */
export const AMMO_UNIT_PRICE: Record<AmmoKind, number> = {
  M_PISTOL: 1,
  H_PISTOL: 1,
  VH_PISTOL: 1,
  SLUG: 1,
  RIFLE: 1,
  ARROW: 1,
};

/** Armaduras por SP (vale para corpo ou cabeça). */
export const ARMOR_BY_SP: Array<{ sp: number; name: string; price: number }> = [
  { sp: 4, name: 'Couro reforçado', price: 20 },
  { sp: 7, name: 'Kevlar', price: 50 },
  { sp: 11, name: 'Armorjack leve', price: 100 },
  { sp: 12, name: 'Armorjack médio', price: 500 },
  { sp: 13, name: 'Armorjack pesado', price: 1000 },
];

export const CONSUMABLE_PRICE = 50;
export const MIN_FREE_PRICE = 5;
export const MAX_FREE_PRICE = 20_000;

export interface PriceQuery {
  category: ItemCategory;
  quantity: number;
  weaponClass?: WeaponClass;
  armorSP?: number;
  armorSlot?: HitLocation;
  ammoKind?: AmmoKind;
  proposedPrice?: number;
}

/** Preço total pelo catálogo; quando não há referência, usa o preço proposto dentro de limites. */
export function priceFor(q: PriceQuery): { total: number; source: 'catalog' | 'proposed' } {
  const qty = Math.max(1, Math.round(q.quantity));
  if (q.category === 'weapon' && q.weaponClass) return { total: WEAPON_PRICES[q.weaponClass], source: 'catalog' };
  if (q.category === 'ammo' && q.ammoKind) return { total: AMMO_UNIT_PRICE[q.ammoKind] * qty, source: 'catalog' };
  if (q.category === 'armor' && q.armorSP) {
    const row = [...ARMOR_BY_SP].reverse().find(r => (q.armorSP ?? 0) >= r.sp) ?? ARMOR_BY_SP[0];
    return { total: row.price, source: 'catalog' };
  }
  if (q.category === 'consumable') return { total: CONSUMABLE_PRICE * qty, source: 'catalog' };
  const proposed = Math.round(Number(q.proposedPrice) || 0);
  return { total: Math.min(MAX_FREE_PRICE, Math.max(MIN_FREE_PRICE, proposed)) * qty, source: 'proposed' };
}
