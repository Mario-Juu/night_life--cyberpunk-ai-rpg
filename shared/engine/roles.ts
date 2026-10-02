/**
 * Habilidades de Papel aplicadas pelo motor: alocação de pontos, subir de rank e efeitos em testes/combate.
 */
import type { Character, CombatAwarenessKey, DrugKey, MakerKey, MedicineKey, NomadUpgradeKey, RoleData, RoleId } from '../types/game';
import {
  COMBAT_AWARENESS,
  DRUG_ORDER,
  MAX_ROLE_RANK,
  MEDICINE_SPECIALTIES,
  START_ROLE_RANK,
  combatAwarenessValue,
  familyVehicle,
  NOMAD_UPGRADES,
  makerPointsTotal,
  roleUpgradeCost,
  surgerySkill,
} from '../rules/roles';

export type RoleSection = 'combatAwareness' | 'maker' | 'medicine';

/** Alocação inicial sensata para cada papel (o jogador pode redistribuir). */
export function defaultRoleData(role: RoleId): RoleData {
  if (role === 'solo') return { combatAwareness: { precision: 3, initiative: 1 } };
  if (role === 'tech') return { maker: { field: 4, upgrade: 2, fabrication: 2 } };
  if (role === 'medtech') return { medicine: { surgery: 1, pharma: 2, cryo: 1 } };
  return {};
}

const sum = (rec: Partial<Record<string, number>> | undefined) => Object.values(rec ?? {}).reduce<number>((n, v) => n + (v ?? 0), 0);

/** Redistribuição atômica da Consciência de Combate; em luta, a ferramenta consome a Ação. */
export function setCombatAwareness(c: Character, values: Partial<Record<CombatAwarenessKey, number>>): Character | string {
  if (c.bio.role !== 'solo') return 'Só Solos têm Consciência de Combate.';
  const next: Partial<Record<CombatAwarenessKey, number>> = {};
  for (const option of COMBAT_AWARENESS) {
    const value = Math.round(values[option.key] ?? 0);
    if (value < 0 || value > option.max || value % option.step !== 0) return `${option.label}: alocação inválida.`;
    if (value) next[option.key] = value;
  }
  if (sum(next) !== c.roleRank) return `Distribua exatamente ${c.roleRank} ponto(s) de Consciência de Combate.`;
  return { ...c, roleData: { ...c.roleData, combatAwareness: next } };
}

/** Pontos ainda livres na seção (0 para papéis sem alocação). */
export function freePoints(c: Character): number {
  const d = c.roleData;
  switch (c.bio.role) {
    case 'solo':
      return c.roleRank - sum(d.combatAwareness);
    case 'tech':
      return makerPointsTotal(c.roleRank) - sum(d.maker);
    case 'medtech':
      return c.roleRank - sum(d.medicine);
    default:
      return 0;
  }
}

/** Ajusta a alocação de um ponto (ou passo). Retorna erro legível se violar as regras. */
export function allocate(c: Character, section: RoleSection, key: string, delta: number, inCombat = false): Character | string {
  const d = c.roleData;
  if (section === 'combatAwareness') {
    if (c.bio.role !== 'solo') return 'Só Solos têm Consciência de Combate.';
    if (inCombat) return 'Reajustar a Consciência de Combate no meio da luta custa sua Ação — faça isso fora do combate.';
    const opt = COMBAT_AWARENESS.find(o => o.key === key);
    if (!opt) return 'Opção desconhecida.';
    const cur = d.combatAwareness?.[opt.key] ?? 0;
    const next = cur + Math.sign(delta) * opt.step;
    if (next < 0 || next > opt.max) return `${opt.label}: fora do limite.`;
    if (delta > 0 && sum(d.combatAwareness) + opt.step > c.roleRank) return `Sem pontos livres (rank ${c.roleRank}).`;
    return { ...c, roleData: { ...d, combatAwareness: { ...d.combatAwareness, [opt.key]: next } } };
  }
  if (section === 'maker') {
    if (c.bio.role !== 'tech') return 'Só Técnicos têm Fabricante.';
    const k = key as MakerKey;
    const cur = d.maker?.[k] ?? 0;
    const next = cur + Math.sign(delta);
    if (next < 0 || next > c.roleRank) return 'Cada especialidade vai até o rank de Fabricante.';
    if (delta > 0 && sum(d.maker) + 1 > makerPointsTotal(c.roleRank)) return 'Sem pontos de especialidade livres.';
    return { ...c, roleData: { ...d, maker: { ...d.maker, [k]: next } } };
  }
  if (c.bio.role !== 'medtech') return 'Só Medicânicos têm Medicina.';
  const spec = MEDICINE_SPECIALTIES.find(m => m.key === key);
  if (!spec) return 'Especialidade desconhecida.';
  const cur = d.medicine?.[spec.key as MedicineKey] ?? 0;
  const next = cur + Math.sign(delta);
  if (next < 0 || next > spec.max) return `${spec.label}: máximo ${spec.max}.`;
  if (delta > 0 && sum(d.medicine) + 1 > c.roleRank) return 'Sem pontos livres.';
  return { ...c, roleData: { ...d, medicine: { ...d.medicine, [spec.key]: next } } };
}

/** Sobe o rank gastando PM (60 × novo rank). */
export function improveRole(c: Character): Character | string {
  if (c.roleRank >= MAX_ROLE_RANK) return 'Rank máximo.';
  const cost = roleUpgradeCost(c.roleRank + 1);
  if (c.ip < cost) return `Precisa de ${cost} PM.`;
  let next: Character = { ...c, ip: c.ip - cost, roleRank: c.roleRank + 1 };
  if (c.bio.role === 'nomad') next = { ...next, inventory: next.inventory.map(i => (i.id === VEHICLE_ITEM_ID ? { ...i, name: familyVehicle(next.roleRank, next.nomadUpgrades) } : i)) };
  return next;
}

/** Escolhe ou devolve uma melhoria do veículo familiar; o rank limita quantas ficam ativas. */
export function toggleNomadUpgrade(c: Character, key: NomadUpgradeKey): Character | string {
  if (c.bio.role !== 'nomad') return 'Só Nômades têm um veículo de família via Moto.';
  if (!NOMAD_UPGRADES.some(u => u.key === key)) return 'Melhoria de veículo desconhecida.';
  const current = c.nomadUpgrades ?? [];
  const upgrades = current.includes(key) ? current.filter(x => x !== key) : current.length >= c.roleRank ? null : [...current, key];
  if (!upgrades) return `Seu rank Moto permite ${c.roleRank} melhoria(s) ativa(s). Remova uma antes de escolher outra.`;
  return { ...c, nomadUpgrades: upgrades, inventory: c.inventory.map(i => (i.id === VEHICLE_ITEM_ID ? { ...i, name: familyVehicle(c.roleRank, upgrades) } : i)) };
}

export const VEHICLE_ITEM_ID = 'item_family_vehicle';

/** Drogas que o Medicânico sabe fabricar (1 por ponto de Farmacêutica). */
export function unlockedDrugs(data: RoleData): DrugKey[] {
  return DRUG_ORDER.slice(0, Math.min(5, data.medicine?.pharma ?? 0));
}

export function soloValue(c: Character, key: CombatAwarenessKey): number {
  return c.bio.role === 'solo' ? combatAwarenessValue(c.roleData, key) : 0;
}

/** Valor da pseudo-perícia Cirurgia (só Medicânicos). */
export function surgeryValue(c: Character): number {
  return c.bio.role === 'medtech' ? surgerySkill(c.roleData) : 0;
}

/** Defaults para saves antigos. */
export function withRoleDefaults(c: Character): Character {
  return {
    ...c,
    roleRank: typeof c.roleRank === 'number' ? c.roleRank : START_ROLE_RANK,
    roleData: c.roleData ?? defaultRoleData(c.bio.role),
  };
}
