import type { Character, InventoryItem, RoleId, StatKey, Stats, WeaponClass } from '../types/game';
import { STAT_KEYS, computeMaxHp, computeMaxHumanity } from './stats';
import { SKILLS } from './skills';
import { AMMO_LABEL, WEAPONS } from './weapons';

export const POINT_BUDGET = 62;
export const STAT_MIN = 2;
export const STAT_MAX = 8;
export const STARTING_MONEY = 500;

export interface RoleInfo {
  id: RoleId;
  label: string;
  tagline: string;
  /** Níveis de perícia do pacote do papel (sobrescrevem o básico 2). */
  skills: Record<string, number>;
  gear: Omit<InventoryItem, 'id'>;
}

export const ROLES: readonly RoleInfo[] = [
  {
    id: 'solo',
    label: 'Solo',
    tagline: 'Mercenário de aluguel. Resolve problemas com chumbo.',
    skills: { handgun: 6, shoulder_arms: 4, melee_weapon: 4, brawling: 4, evasion: 6, athletics: 4, perception: 4, stealth: 4, interrogation: 3 },
    gear: { name: 'Coldre de Saque Rápido & Óculos Balísticos', category: 'gear', quantity: 1, description: 'Equipamento tático para proteção contra estilhaços.', equipped: true, value: 100 },
  },
  {
    id: 'netrunner',
    label: 'Trilheiro',
    tagline: 'Invasor da Rede. Mente rápida, corpo frágil.',
    skills: { interface: 6, electronics_security: 5, cybertech: 4, library_search: 4, stealth: 4, handgun: 3, deduction: 3 },
    gear: { name: 'Ciberdeck Portátil Kirama', category: 'gear', quantity: 1, description: 'Deck de entrada para pontos de acesso físicos.', equipped: true, value: 200 },
  },
  {
    id: 'tech',
    label: 'Técnico',
    tagline: 'Conserta, improvisa e constrói o impossível.',
    skills: { basic_tech: 6, weaponstech: 5, cybertech: 5, electronics_security: 5, pick_lock: 4, handgun: 3, deduction: 3 },
    gear: { name: 'Kit de Ferramentas de Precisão', category: 'gear', quantity: 1, description: 'Chaves magnéticas, micro-solda e multímetro.', equipped: true, value: 150 },
  },
  {
    id: 'medtech',
    label: 'Medicânico',
    tagline: 'Mantém a equipe viva quando a Equipe de Trauma não vem.',
    skills: { first_aid: 6, cybertech: 5, human_perception: 4, deduction: 4, conversation: 4, handgun: 3, resist_torture: 3 },
    gear: { name: 'Estojo Médico de Emergência', category: 'gear', quantity: 1, description: 'Agulhas hemostáticas, biocurativos e bisturi.', equipped: true, value: 150 },
  },
  {
    id: 'fixer',
    label: 'Canal',
    tagline: 'Conhece todo mundo. Todo mundo deve algo a ele.',
    skills: { streetwise: 6, trading: 5, persuasion: 5, bribery: 4, human_perception: 4, conversation: 4, handgun: 3, local_expert: 4 },
    gear: { name: 'Holo-Gravador Oculto', category: 'gear', quantity: 1, description: 'Grava acordos e guarda contatos criptografados.', equipped: true, value: 120 },
  },
  {
    id: 'nomad',
    label: 'Nômade',
    tagline: 'Da estrada e do clã. Leal até o fim.',
    skills: { drive: 6, shoulder_arms: 5, handgun: 4, athletics: 4, endurance: 4, basic_tech: 4, tracking: 3, evasion: 4 },
    gear: { name: 'Cantil Filtrante & Óculos de Tempestade', category: 'gear', quantity: 1, description: 'Sobrevivência nos Ermos.', equipped: true, value: 80 },
  },
];

export function getRole(id: RoleId): RoleInfo {
  return ROLES.find(r => r.id === id) ?? ROLES[0];
}

export interface StatPreset {
  id: string;
  label: string;
  stats: Stats;
}

export const STAT_PRESETS: readonly StatPreset[] = [
  { id: 'balanced', label: 'Equilibrado', stats: { INT: 6, REF: 7, DEX: 7, TECH: 5, COOL: 6, WILL: 6, LUCK: 6, MOVE: 6, BODY: 7, EMP: 6 } },
  { id: 'reflex', label: 'Gatilho Rápido', stats: { INT: 5, REF: 8, DEX: 8, TECH: 4, COOL: 6, WILL: 5, LUCK: 6, MOVE: 7, BODY: 6, EMP: 7 } },
  { id: 'brains', label: 'Engenhoso', stats: { INT: 8, REF: 5, DEX: 5, TECH: 8, COOL: 5, WILL: 6, LUCK: 6, MOVE: 5, BODY: 6, EMP: 8 } },
  { id: 'tough', label: 'Tanque de Rua', stats: { INT: 5, REF: 7, DEX: 6, TECH: 5, COOL: 6, WILL: 7, LUCK: 5, MOVE: 6, BODY: 8, EMP: 7 } },
  { id: 'social', label: 'Lábia', stats: { INT: 7, REF: 5, DEX: 5, TECH: 4, COOL: 8, WILL: 6, LUCK: 7, MOVE: 5, BODY: 7, EMP: 8 } },
];

export function statTotal(stats: Stats): number {
  return STAT_KEYS.reduce((sum, k) => sum + stats[k], 0);
}

/** Ajuste de atributo respeitando mínimo, máximo e orçamento. Retorna o mesmo objeto se inválido. */
export function adjustStat(stats: Stats, key: StatKey, delta: number): Stats {
  const next = stats[key] + delta;
  if (next < STAT_MIN || next > STAT_MAX) return stats;
  if (delta > 0 && statTotal(stats) + delta > POINT_BUDGET) return stats;
  return { ...stats, [key]: next };
}

export function validateStats(stats: Stats): string | null {
  for (const k of STAT_KEYS) {
    if (!Number.isInteger(stats[k]) || stats[k] < STAT_MIN || stats[k] > STAT_MAX) return `${k} deve estar entre ${STAT_MIN} e ${STAT_MAX}.`;
  }
  const total = statTotal(stats);
  if (total !== POINT_BUDGET) return `Distribua exatamente ${POINT_BUDGET} pontos (atual: ${total}).`;
  return null;
}

export interface StarterWeapon {
  id: string;
  name: string;
  weaponClass: WeaponClass;
  description: string;
  magSize: number | null;
  spareAmmo: number;
}

export const STARTER_WEAPONS: readonly StarterWeapon[] = [
  { id: 'pistol', name: 'Pistola Dai Lung Streetmaster', weaponClass: 'pistol_medium', description: 'Pistola média de sarjeta. Confiável e barata.', magSize: 12, spareAmmo: 24 },
  { id: 'revolver', name: 'Revólver Nova 357', weaponClass: 'pistol_heavy', description: 'Revólver pesado de cilindro reforçado. Alto impacto.', magSize: 6, spareAmmo: 18 },
  { id: 'shotgun', name: 'Escopeta Serrada Palica', weaponClass: 'shotgun', description: 'Cano serrado para corredores estreitos. Devastadora de perto.', magSize: 2, spareAmmo: 10 },
  { id: 'knife', name: 'Faca Tática de Combate', weaponClass: 'melee_light', description: 'Lâmina de carbono. Armas brancas ignoram metade da SP.', magSize: null, spareAmmo: 0 },
];

export interface CreationInput {
  name: string;
  handle: string;
  age: number;
  role: RoleId;
  occupation: string;
  district: string;
  familyTie: string;
  debtReason: string;
  personalAnchor: string;
  appearance: string;
  stats: Stats;
  starterWeaponId: string;
}

export function buildStartingSkills(role: RoleId): Record<string, number> {
  const skills: Record<string, number> = {};
  for (const s of SKILLS) skills[s.id] = s.basic ? 2 : 0;
  const pack = getRole(role).skills;
  for (const [id, level] of Object.entries(pack)) skills[id] = Math.max(skills[id] ?? 0, level);
  return skills;
}

export function buildCharacter(input: CreationInput): Character {
  const error = validateStats(input.stats);
  if (error) throw new Error(error);

  const role = getRole(input.role);
  const starter = STARTER_WEAPONS.find(w => w.id === input.starterWeaponId) ?? STARTER_WEAPONS[0];
  const profile = WEAPONS[starter.weaponClass];

  const inventory: InventoryItem[] = [
    {
      id: 'item_starter_weapon',
      name: starter.name,
      category: 'weapon',
      quantity: 1,
      description: starter.description,
      equipped: true,
      value: 100,
      weapon: {
        weaponClass: starter.weaponClass,
        damage: profile.defaultDamage,
        magSize: starter.magSize,
        loaded: starter.magSize ?? 0,
        ammo: profile.ammo,
      },
    },
  ];

  if (profile.ammo && starter.spareAmmo > 0) {
    inventory.push({
      id: 'item_starter_ammo',
      name: AMMO_LABEL[profile.ammo],
      category: 'ammo',
      quantity: starter.spareAmmo,
      description: 'Cartuchos avulsos para recarga.',
      ammoKind: profile.ammo,
      value: 10,
    });
  }

  inventory.push(
    { id: 'item_role_gear', ...role.gear },
    {
      id: 'item_starter_jacket',
      name: 'Jaqueta com Forro Balístico Leve',
      category: 'armor',
      quantity: 1,
      description: 'Jaqueta gasta com inserção de Kevlar.',
      equipped: true,
      value: 100,
      armor: { slot: 'body', sp: 7, maxSp: 7 },
    },
    {
      id: 'item_starter_cap',
      name: 'Boné Reforçado',
      category: 'armor',
      quantity: 1,
      description: 'Placa leve costurada no forro. Melhor que nada.',
      equipped: false,
      value: 40,
      armor: { slot: 'head', sp: 4, maxSp: 4 },
    },
    {
      id: 'item_starter_medkit',
      name: 'Biocurativo Rápido',
      category: 'consumable',
      quantity: 2,
      description: 'Recupera 1d6 PV fora de combate.',
      heal: 6,
      value: 50,
    },
    {
      id: 'item_starter_agent',
      name: 'Agente de Bolso',
      category: 'gear',
      quantity: 1,
      description: 'Holo-comunicador com agenda e sinal local.',
      equipped: true,
      value: 80,
    },
  );

  const maxHp = computeMaxHp(input.stats.BODY, input.stats.WILL);
  const maxHumanity = computeMaxHumanity(input.stats.EMP);

  return {
    bio: {
      name: input.name.trim() || 'Alex',
      handle: input.handle.trim() || 'Novato',
      age: Math.min(60, Math.max(16, Math.round(input.age) || 20)),
      role: role.id,
      occupation: input.occupation.trim() || 'Bicos noturnos',
      district: input.district,
      familyTie: input.familyTie.trim(),
      debtReason: input.debtReason.trim(),
      personalAnchor: input.personalAnchor.trim(),
      appearance: input.appearance.trim(),
    },
    stats: { ...input.stats },
    skills: buildStartingSkills(role.id),
    hp: { current: maxHp, max: maxHp },
    humanity: { current: maxHumanity, max: maxHumanity },
    luck: { current: input.stats.LUCK, max: input.stats.LUCK },
    money: STARTING_MONEY,
    reputation: 0,
    ip: 0,
    inventory,
    cyberware: [],
    criticalInjuries: [],
    deathSavePenalty: 0,
    stabilized: false,
    dead: false,
  };
}
