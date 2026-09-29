/**
 * Implementação ÚNICA de dados do jogo.
 * O "Rng" recebe o número de faces e devolve uma face (1..sides).
 * Produção usa crypto; testes usam sequências determinísticas.
 */
import type { D10Roll, DamageRoll } from '../types/game';

export type Rng = (sides: number) => number;

export const cryptoRng: Rng = (sides: number) => {
  const c = globalThis.crypto;
  let r: number;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    r = buf[0] / 0x1_0000_0000;
  } else {
    r = Math.random();
  }
  return Math.floor(r * sides) + 1;
};

/** Gera uma seed nova (hex) a partir do RNG criptográfico. */
export function newSeed(): string {
  return Array.from({ length: 4 }, () => cryptoRng(0x10000).toString(16).padStart(4, '0')).join('');
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** RNG determinístico (mulberry32): a mesma seed reproduz exatamente as mesmas rolagens. */
export function seededRng(seed: string): Rng {
  let a = hashSeed(seed);
  return (sides: number) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(r * sides) + 1;
  };
}

export interface RecordedDie {
  sides: number;
  face: number;
}

/** Envolve um RNG registrando cada dado rolado (para o Turn e para replays). */
export function recordingRng(inner: Rng): { rng: Rng; log: RecordedDie[] } {
  const log: RecordedDie[] = [];
  return {
    log,
    rng: (sides: number) => {
      const face = inner(sides);
      log.push({ sides, face });
      return face;
    },
  };
}

/** Dados determinísticos (testes): devolve os valores em ordem, limitados às faces. */
export function sequenceRng(values: number[]): Rng {
  let i = 0;
  return (sides: number) => {
    const v = values[i % values.length];
    i++;
    return Math.min(sides, Math.max(1, v));
  };
}

export function rollDie(sides: number, rng: Rng = cryptoRng): number {
  return rng(sides);
}

/**
 * 1d10 de Cyberpunk RED: 10 natural soma mais 1d10 (crítico);
 * 1 natural subtrai 1d10 (falha crítica). Apenas uma explosão.
 */
export function rollD10(rng: Rng = cryptoRng): D10Roll {
  const natural = rng(10);
  if (natural === 10) {
    const extra = rng(10);
    return { rolls: [natural, extra], natural, total: natural + extra, crit: true, fumble: false };
  }
  if (natural === 1) {
    const extra = rng(10);
    return { rolls: [natural, extra], natural, total: natural - extra, crit: false, fumble: true };
  }
  return { rolls: [natural], natural, total: natural, crit: false, fumble: false };
}

export interface DiceNotation {
  count: number;
  sides: number;
  bonus: number;
}

export function parseNotation(notation: string): DiceNotation | null {
  const m = notation.trim().toLowerCase().match(/^(\d{1,2})d(\d{1,3})\s*(?:([+-])\s*(\d{1,3}))?$/);
  if (!m) return null;
  const count = Number(m[1]);
  const sides = Number(m[2]);
  if (count < 1 || sides < 2) return null;
  const bonus = m[3] ? (m[3] === '-' ? -1 : 1) * Number(m[4]) : 0;
  return { count, sides, bonus };
}

export function isValidNotation(notation: unknown): notation is string {
  return typeof notation === 'string' && parseNotation(notation) !== null;
}

/** Dano: ferimento crítico quando 2+ dados d6 mostram 6. */
export function rollDamage(notation: string, rng: Rng = cryptoRng): DamageRoll {
  const parsed = parseNotation(notation) ?? { count: 2, sides: 6, bonus: 0 };
  const rolls = Array.from({ length: parsed.count }, () => rng(parsed.sides));
  const sixes = parsed.sides === 6 ? rolls.filter(r => r === 6).length : 0;
  const total = Math.max(0, rolls.reduce((a, b) => a + b, 0) + parsed.bonus);
  return { notation, rolls, total, sixes, critical: sixes >= 2 };
}

/** Escolhe um elemento usando o rng de faces. */
export function pick<T>(items: readonly T[], rng: Rng = cryptoRng): T {
  return items[rng(items.length) - 1];
}

/** Agrupa os dados registrados numa RollRecord única (ex.: "1d10+1d10+2d6"). */
export function toRollRecord(log: RecordedDie[], meta: { rollId: string; seed: string; purpose: string; timestamp?: string }) {
  const groups = new Map<number, number>();
  for (const d of log) groups.set(d.sides, (groups.get(d.sides) ?? 0) + 1);
  return {
    rollId: meta.rollId,
    dice: [...groups].map(([sides, n]) => `${n}d${sides}`).join('+') || '—',
    results: log.map(d => d.face),
    total: log.reduce((s, d) => s + d.face, 0),
    seed: meta.seed,
    timestamp: meta.timestamp ?? new Date().toISOString(),
    purpose: meta.purpose,
  };
}
