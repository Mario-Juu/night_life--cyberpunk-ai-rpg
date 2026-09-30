import type { Character, CheckResult, Modifier, StatKey } from '../types/game';
import { effectiveEmp } from '../rules/stats';
import { cryptoRng, rollD10, type Rng } from './dice';
import { checkPenalties } from './health';
import { roleSkillBonus } from '../rules/roles';
import { surgeryValue } from './roles';
import { chipSkillFloor, cyberSkillBonus } from './cyberBonus';

export function statValue(c: Character, stat: StatKey): number {
  if (stat === 'EMP') return Math.min(c.stats.EMP, effectiveEmp(c.humanity.current));
  return c.stats[stat];
}

export function skillValue(c: Character, skillId: string | null): number {
  if (!skillId) return 0;
  // Cirurgia não é perícia comum: vem da Medicina do Medicânico (+2 por ponto).
  if (skillId === 'surgery') return surgeryValue(c);
  // Chip de Perícia: vale pelo menos 3 enquanto estiver encaixado.
  return Math.max(c.skills[skillId] ?? 0, chipSkillFloor(c, skillId));
}

export interface CheckInput {
  stat: StatKey;
  skillId: string | null;
  dv: number;
  /** Modificadores situacionais (GM, mira, etc.). */
  modifiers?: Modifier[];
  luckSpent?: number;
  /** Solo com Recuperação de Falha: o 1 natural não implode. */
  ignoreFumble?: boolean;
}

/** Quanto de Sorte pode ser gasto agora. */
export function clampLuck(c: Character, requested: number | undefined): number {
  return Math.max(0, Math.min(c.luck.current, Math.round(requested ?? 0)));
}

/**
 * Teste de perícia: STAT + perícia + 1d10 + modificadores + penalidades + Sorte.
 * Cyberpunk RED: é preciso SUPERAR o DV (empate favorece a dificuldade).
 */
export function resolveCheck(c: Character, input: CheckInput, rng: Rng = cryptoRng): CheckResult {
  const sv = statValue(c, input.stat);
  const kv = skillValue(c, input.skillId);
  let d10 = rollD10(rng);
  if (input.ignoreFumble && d10.fumble) d10 = { ...d10, rolls: [d10.natural], total: d10.natural, fumble: false };
  const luckSpent = clampLuck(c, input.luckSpent);
  const roleBonus = roleSkillBonus(c.bio.role, c.roleRank, c.roleData, input.skillId);
  const cyberBonus = cyberSkillBonus(c, input.skillId);
  const modifiers = [...(input.modifiers ?? []).filter(m => m.value !== 0), ...(roleBonus ? [roleBonus] : []), ...(cyberBonus ? [cyberBonus] : []), ...checkPenalties(c, input.stat)];
  const modTotal = modifiers.reduce((sum, m) => sum + m.value, 0);
  const total = sv + kv + d10.total + modTotal + luckSpent;
  return {
    stat: input.stat,
    statValue: sv,
    skillId: input.skillId,
    skillValue: kv,
    d10,
    modifiers,
    luckSpent,
    total,
    dv: input.dv,
    success: total > input.dv,
    margin: total - input.dv,
  };
}

export function spendLuck(c: Character, amount: number): Character {
  if (amount <= 0) return c;
  return { ...c, luck: { ...c.luck, current: Math.max(0, c.luck.current - amount) } };
}
