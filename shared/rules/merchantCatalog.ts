/**
 * Mercadorias com efeito mecânico. A ficção pode dar apelidos e marcas diferentes, mas a regra
 * sempre vem daqui — um "Injector de Stim" continua sendo Stim de verdade, não uma descrição solta.
 */
import type { AmmoKind, DrugKey, ItemCategory, StreetDrugKey, WeaponClass } from '../types/game';
import { ARMOR_BY_SP, AMMO_UNIT_PRICE, WEAPON_PRICES } from './catalog';
import { DRUGS } from './roles';
import { STREET_DRUGS } from './streetDrugs';
import { WEAPONS } from './weapons';

export type MerchantKind = 'street' | 'medical' | 'weapons' | 'armor' | 'general';

export interface MerchantItemDef {
  key: string;
  name: string;
  category: ItemCategory;
  description: string;
  price: number;
  merchants: MerchantKind[];
  weaponClass?: WeaponClass;
  ammoKind?: AmmoKind;
  armorSP?: number;
  armorSlot?: 'head' | 'body';
  heal?: number;
  drug?: DrugKey;
  streetDrug?: StreetDrugKey;
  aliases?: string[];
}

const medical = Object.entries(DRUGS).map(([drug, def]) => ({
  key: `medical_${drug}`,
  name: def.label,
  category: 'consumable' as const,
  description: def.description,
  price: 50,
  merchants: ['medical'] as MerchantKind[],
  drug: drug as DrugKey,
  aliases: [drug, def.label],
}));

const streetDrugs = Object.entries(STREET_DRUGS).map(([drug, def]) => ({
  key: `street_${drug}`,
  name: def.label,
  category: 'consumable' as const,
  description: def.description,
  price: def.price,
  merchants: ['street'] as MerchantKind[],
  streetDrug: drug as StreetDrugKey,
  aliases: [drug, ...def.aliases],
}));

const weapons = (Object.keys(WEAPONS) as WeaponClass[])
  .filter(key => !['unarmed', 'martial_arts'].includes(key))
  .map(key => ({
    key: `weapon_${key}`,
    name: WEAPONS[key].label,
    category: 'weapon' as const,
    description: `Arma padrão: ${WEAPONS[key].defaultDamage}.`,
    price: WEAPON_PRICES[key],
    merchants: ['weapons', 'street'] as MerchantKind[],
    weaponClass: key,
  }));

const ammo = (Object.keys(AMMO_UNIT_PRICE) as AmmoKind[]).map(key => ({
  key: `ammo_${key}`,
  name: `Munição ${key}`,
  category: 'ammo' as const,
  description: 'Munição padrão compatível.',
  price: AMMO_UNIT_PRICE[key],
  merchants: ['weapons', 'street', 'general'] as MerchantKind[],
  ammoKind: key,
}));

const armor = ARMOR_BY_SP.flatMap(row => (['body', 'head'] as const).map(slot => ({
  key: `armor_${row.sp}_${slot}`,
  name: `${row.name} (${slot === 'head' ? 'cabeça' : 'corpo'})`,
  category: 'armor' as const,
  description: `Proteção padrão SP ${row.sp}.`,
  price: row.price,
  merchants: ['armor', 'street'] as MerchantKind[],
  armorSP: row.sp,
  armorSlot: slot,
})));

const entries: MerchantItemDef[] = [
  { key: 'biocurativo', name: 'Biocurativo', category: 'consumable', description: 'Recupera 1d6 PV.', price: 50, merchants: ['medical', 'general'], heal: 6, aliases: ['kit medico', 'kit médico', 'medkit', 'biocurativo'] },
  ...medical,
  ...streetDrugs,
  ...weapons,
  ...ammo,
  ...armor,
];

export const MERCHANT_CATALOG: Record<string, MerchantItemDef> = Object.fromEntries(entries.map(item => [item.key, item]));

export const MERCHANT_ITEM_KEYS = Object.keys(MERCHANT_CATALOG);
export const MERCHANT_KINDS: MerchantKind[] = ['street', 'medical', 'weapons', 'armor', 'general'];

const norm = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();

export function merchantItem(key: string | undefined): MerchantItemDef | undefined {
  // A chave vem do LLM/save: só propriedades PRÓPRIAS ("constructor"/"__proto__" são do protótipo).
  return key && Object.hasOwn(MERCHANT_CATALOG, key) ? MERCHANT_CATALOG[key] : undefined;
}

/** Reconhece saves e apelidos antigos, sem aceitar efeitos improvisados. */
export function guessMerchantItem(name: string): MerchantItemDef | undefined {
  const n = norm(name);
  return Object.values(MERCHANT_CATALOG).find(item => [item.name, ...(item.aliases ?? [])].some(alias => n.includes(norm(alias))));
}

export function merchantStock(kind: MerchantKind): MerchantItemDef[] {
  return Object.values(MERCHANT_CATALOG).filter(item => item.merchants.includes(kind));
}
