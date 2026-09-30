/**
 * Consultas PURAS do cromo (bônus que o motor aplica em testes, iniciativa, dano…).
 * Só depende das regras — pode ser importado por checks/health/combat sem ciclos.
 */
import type { Character, CyberwareItem, GameState, Modifier } from '../types/game';
import { CYBERWARE, type CyberEffect, type CyberwareDef, type OsSpec } from '../rules/cyberware';

export const defOf = (cw: CyberwareItem): CyberwareDef | undefined => (cw.key ? CYBERWARE[cw.key] : undefined);
export const effectsOf = (c: Character): CyberEffect[] => c.cyberware.flatMap(cw => defOf(cw)?.effects ?? []);

export const hasCyber = (c: Character, key: string) => c.cyberware.some(cw => cw.key === key);

// ---------------------------------------------------------------- consultas do motor

/** Bônus de perícia do cromo (o maior por perícia; não somam entre si). */
export function cyberSkillBonus(c: Character, skillId: string | null): Modifier | null {
  if (!skillId) return null;
  let best: { v: number; name: string } | null = null;
  for (const cw of c.cyberware) {
    for (const e of defOf(cw)?.effects ?? []) {
      if (e.kind === 'skill' && e.value > 0 && e.skills.includes(skillId) && (!best || e.value > best.v)) best = { v: e.value, name: cw.name };
    }
  }
  return best ? { label: best.name, value: best.v } : null;
}

/** Chip de perícia: a perícia vale pelo menos o nível do chip enquanto estiver encaixado. */
export function chipSkillFloor(c: Character, skillId: string | null): number {
  if (!skillId) return 0;
  let floor = 0;
  for (const cw of c.cyberware) {
    if (cw.skillId !== skillId) continue;
    for (const e of defOf(cw)?.effects ?? []) if (e.kind === 'skill_chip') floor = Math.max(floor, e.value);
  }
  return floor;
}

// ---------------------------------------------------------------- sistema operacional (Sandevistan/Berserk)

/** O SO instalado (só cabe um). */
export function installedOs(c: Character): { cw: CyberwareItem; def: CyberwareDef; os: OsSpec } | null {
  for (const cw of c.cyberware) {
    const def = defOf(cw);
    if (def?.os) return { cw, def, os: def.os };
  }
  return null;
}

export const osOnName = (def: Pick<CyberwareDef, 'name'>) => `${def.name} ativo`;
export const osCooldownName = (def: Pick<CyberwareDef, 'name'>) => `${def.name} (recarregando)`;

/** SO ligado agora: em combate conta rodadas; fora dele, o efeito narrativo de 1 minuto. */
export function activeOs(s: Pick<GameState, 'character' | 'combat' | 'activeEffects'>): OsSpec | null {
  const inst = installedOs(s.character);
  if (!inst) return null;
  const run = s.combat.os;
  if (s.combat.active && run && run.key === inst.def.key && s.combat.round < run.startRound + run.rounds) return inst.os;
  if (!s.combat.active && s.activeEffects.some(e => e.name === osOnName(inst.def))) return inst.os;
  return null;
}

export function cyberInitiative(s: Pick<GameState, 'character' | 'activeEffects' | 'combat'>): Modifier[] {
  const mods: Modifier[] = [];
  for (const cw of s.character.cyberware) for (const e of defOf(cw)?.effects ?? []) if (e.kind === 'initiative') mods.push({ label: cw.name, value: e.value });
  const os = activeOs(s);
  const inst = installedOs(s.character);
  if (os?.initiative && inst) mods.push({ label: inst.def.name, value: os.initiative });
  return mods;
}

export const cyberAimedBonus = (c: Character) => Math.max(0, ...effectsOf(c).map(e => (e.kind === 'aimed' ? e.value : 0)));
export const cyberLongRangeBonus = (c: Character) => Math.max(0, ...effectsOf(c).map(e => (e.kind === 'long_range' ? e.value : 0)));
export const hasPainEditor = (c: Character) => effectsOf(c).some(e => e.kind === 'pain_editor');
export const hasDoubleHealing = (c: Character) => effectsOf(c).some(e => e.kind === 'double_healing');
export const hasNetrunLink = (c: Character) => effectsOf(c).some(e => e.kind === 'netrun_link');
export const hasSecondHeart = (c: Character) => effectsOf(c).some(e => e.kind === 'second_heart');
/** Esquiva de balas sem REF 8 (Kerenzikov militar). */
export const cyberDodgeBullets = (c: Character) => effectsOf(c).some(e => e.kind === 'dodge_bullets');
/** Redução fixa de dano do cromo passivo (o maior vale). */
export const cyberDamageReduction = (c: Character) => Math.max(0, ...effectsOf(c).map(e => (e.kind === 'damage_reduction' ? e.value : 0)));

export const SECOND_HEART_COOLDOWN = 'Segundo Coração (recarregando)';
